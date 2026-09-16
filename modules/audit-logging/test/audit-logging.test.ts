import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, Guid, NullLoggerFactory, UserFriendlyException } from "@abp/core";
import { AuditLogActionInfo, AuditLogInfo, EntityChangeInfo, EntityChangeType, EntityPropertyChangeInfo, IAuditingManager, IAuditingStore } from "@abp/auditing";
import { EntityNotFoundException } from "@abp/ddd-domain";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpAuditLoggingDomainModule, AuditLog, AuditLogAction, AuditingStore, EntityChange, EntityPropertyChange, IAuditLogRepository } from "../src/domain/index.js";
import { AbpAuditLoggingMemoryDbModule } from "../src/memory-db/index.js";

@DependsOn(AbpAuditLoggingDomainModule, AbpAuditLoggingMemoryDbModule)
class TestModule extends AbpModule {}

const test = createAbpIntegratedTest(TestModule, {
  setAbpApplicationCreationOptions: (options) => {
    options.applicationName = "AuditTests";
    options.loggerFactory = NullLoggerFactory.instance;
  },
});

beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const userA = "0b7c9d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const userB = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const userC = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

interface LogInit {
  userId?: string;
  userName?: string;
  httpMethod?: string;
  url?: string;
  executionTime: Date;
  executionDuration?: number;
  httpStatusCode?: number;
  correlationId?: string;
  exception?: unknown;
  entityChanges?: EntityChangeInfo[];
}

function createLogInfo(init: LogInit): AuditLogInfo {
  const info = new AuditLogInfo();
  info.applicationName = "AuditTests";
  info.userId = init.userId;
  info.userName = init.userName;
  info.httpMethod = init.httpMethod ?? "GET";
  info.url = init.url ?? "/api/app/books";
  info.executionTime = init.executionTime;
  info.executionDuration = init.executionDuration ?? 10;
  info.httpStatusCode = init.httpStatusCode ?? 200;
  info.correlationId = init.correlationId;
  info.clientIpAddress = "10.0.0.1";
  if (init.exception !== undefined) info.exceptions.push(init.exception);
  info.entityChanges.push(...(init.entityChanges ?? []));
  return info;
}

function createEntityChange(entityId: string, changeType: EntityChangeType, changeTime: Date, propertyName = "title", entityTypeFullName = "Book"): EntityChangeInfo {
  const change = new EntityChangeInfo();
  change.changeTime = changeTime;
  change.changeType = changeType;
  change.entityId = entityId;
  change.entityTypeFullName = entityTypeFullName;
  const property = new EntityPropertyChangeInfo();
  property.propertyName = propertyName;
  property.propertyTypeFullName = "string";
  property.originalValue = "old";
  property.newValue = "new";
  change.propertyChanges.push(property);
  return change;
}

function repository(): Promise<AuditLog[]> {
  return test.withUnitOfWork((provider) => provider.getRequired(IAuditLogRepository).getList());
}

describe("AuditingStore", () => {
  it("replaces SimpleLogAuditingStore and persists the audit log with actions, entity changes and exceptions", async () => {
    const store = test.getRequiredService(IAuditingStore);
    expect(store).toBeInstanceOf(AuditingStore);

    const info = createLogInfo({ userId: userA, userName: "john", httpMethod: "POST", url: "/api/app/books", executionTime: new Date("2026-03-01T10:00:00Z"), executionDuration: 120, httpStatusCode: 500, correlationId: "corr-1", exception: new UserFriendlyException("Failed", { code: "App:001" }) });
    const action = new AuditLogActionInfo();
    action.serviceName = "BookAppService";
    action.methodName = "create";
    action.parameters = '{"input":{"title":"DDD"}}';
    action.executionTime = info.executionTime;
    action.executionDuration = 100;
    action.extraProperties.set("Source", "test");
    info.actions.push(action);
    info.entityChanges.push(createEntityChange("book-1", EntityChangeType.Created, info.executionTime));
    info.comments.push("first", "second");
    info.extraProperties.set("Region", "eu");

    await store.save(info);

    const logs = await repository();
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log).toBeInstanceOf(AuditLog);
    expect(Guid.isValid(log.id)).toBe(true);
    expect(log).toMatchObject({ applicationName: "AuditTests", userId: userA, userName: "john", httpMethod: "POST", url: "/api/app/books", executionDuration: 120, httpStatusCode: 500, correlationId: "corr-1", clientIpAddress: "10.0.0.1", comments: "first\nsecond" });
    expect(log.executionTime).toEqual(new Date("2026-03-01T10:00:00Z"));
    expect(log.extraProperties.get("Region")).toBe("eu");
    expect(log.exceptions).toContain('"code": "App:001"');
    expect(log.exceptions).toContain('"message": "Failed"');

    expect(log.actions).toHaveLength(1);
    expect(log.actions[0]).toBeInstanceOf(AuditLogAction);
    expect(log.actions[0]).toMatchObject({ auditLogId: log.id, serviceName: "BookAppService", methodName: "create", parameters: '{"input":{"title":"DDD"}}', executionDuration: 100 });
    expect(log.actions[0]!.extraProperties.get("Source")).toBe("test");

    expect(log.entityChanges).toHaveLength(1);
    const change = log.entityChanges[0]!;
    expect(change).toBeInstanceOf(EntityChange);
    expect(change).toMatchObject({ auditLogId: log.id, changeType: EntityChangeType.Created, entityId: "book-1", entityTypeFullName: "Book" });
    expect(change.propertyChanges[0]).toBeInstanceOf(EntityPropertyChange);
    expect(change.propertyChanges[0]).toMatchObject({ entityChangeId: change.id, propertyName: "title", originalValue: "old", newValue: "new", propertyTypeFullName: "string" });
  });

  it("stores the logs written by the auditing manager", async () => {
    const auditingManager = test.getRequiredService(IAuditingManager);
    await auditingManager.runInScope(async (scope) => {
      scope.log.url = "/api/app/from-scope";
      scope.log.httpMethod = "PUT";
      scope.log.comments.push("via manager");
    });
    const logs = await repository();
    expect(logs.some((l) => l.url === "/api/app/from-scope" && l.httpMethod === "PUT" && l.comments === "via manager")).toBe(true);
  });

  it("truncates values longer than the AuditLogConsts limits", async () => {
    const store = test.getRequiredService(IAuditingStore);
    await store.save(createLogInfo({ url: "/x".repeat(300), executionTime: new Date("2026-03-01T11:00:00Z") }));
    const log = (await repository()).find((l) => l.url?.startsWith("/x/x"));
    expect(log?.url).toHaveLength(256);
  });
});

describe("IAuditLogRepository", () => {
  const day1 = new Date("2026-04-01T08:00:00Z");
  const day1Later = new Date("2026-04-01T18:00:00Z");
  const day2 = new Date("2026-04-02T08:00:00Z");
  let changeIdOfB: string;

  beforeAll(async () => {
    const store = test.getRequiredService(IAuditingStore);
    await store.save(createLogInfo({ userId: userB, userName: "alice", httpMethod: "GET", url: "/api/books/1", executionTime: day1, executionDuration: 50, correlationId: "c-a" }));
    await store.save(createLogInfo({ userId: userB, userName: "alice", httpMethod: "POST", url: "/api/books", executionTime: day1Later, executionDuration: 300, httpStatusCode: 500, exception: new Error("boom"), entityChanges: [createEntityChange("order-2", EntityChangeType.Created, day1Later, "title", "Order")] }));
    await store.save(createLogInfo({ userId: userC, userName: "bob", httpMethod: "DELETE", url: "/api/books/2", executionTime: day2, executionDuration: 20, httpStatusCode: 204, correlationId: "c-b", entityChanges: [createEntityChange("order-2", EntityChangeType.Deleted, day2, "title", "Order"), createEntityChange("order-3", EntityChangeType.Updated, day2, "price", "Order")] }));
    const bobLog = (await repository()).find((l) => l.userName === "bob")!;
    changeIdOfB = bobLog.entityChanges.find((c) => c.entityId === "order-3")!.id;
  });

  it("filters, sorts and pages the logs", async () => {
    const byUser = await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getList({ userId: userB }));
    expect(byUser.map((l) => l.executionTime)).toEqual([day1Later, day1]);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ userId: userB }))).toBe(2);

    expect((await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getList({ userId: userB, sorting: "executionTime asc", maxResultCount: 1 }))).map((l) => l.url)).toEqual(["/api/books/1"]);
    expect((await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getList({ userId: userB, sorting: "executionTime asc", skipCount: 1 }))).map((l) => l.url)).toEqual(["/api/books"]);

    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ httpMethod: "DELETE" }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ url: "/api/books/" }))).toBe(2);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ userName: "bob" }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ applicationName: "AuditTests", startTime: day1, endTime: day2 }))).toBeGreaterThanOrEqual(3);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ startTime: day2, endTime: day2 }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ correlationId: "c-b" }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ hasException: true, userId: userB }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ hasException: false, userId: userB }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ httpStatusCode: 204 }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ minExecutionDuration: 100, userId: userB }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ maxExecutionDuration: 100, userId: userB }))).toBe(1);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount({ clientIpAddress: "10.0.0.9" }))).toBe(0);
    expect(await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getCount())).toBeGreaterThanOrEqual(5);
  });

  it("computes the average execution duration per day", async () => {
    const averages = await test.withUnitOfWork((p) => p.getRequired(IAuditLogRepository).getAverageExecutionDurationPerDay(new Date("2026-03-31T00:00:00Z"), new Date("2026-04-02T00:00:00Z")));
    expect(averages.get("2026-04-01")).toBe(175);
    expect(averages.get("2026-04-02")).toBe(20);
    expect(averages.has("2026-03-01")).toBe(false);
  });

  it("queries entity changes across the logs", async () => {
    const repo = (): Promise<IAuditLogRepository> => Promise.resolve(test.getRequiredService(IAuditLogRepository));

    const changes = await test.withUnitOfWork(async () => (await repo()).getEntityChangeList({ entityId: "order-2" }));
    expect(changes.map((c) => c.changeType)).toEqual([EntityChangeType.Deleted, EntityChangeType.Created]);
    expect(await test.withUnitOfWork(async () => (await repo()).getEntityChangeCount({ entityTypeFullName: "Ord" }))).toBe(3);
    expect(await test.withUnitOfWork(async () => (await repo()).getEntityChangeCount({ changeType: EntityChangeType.Updated }))).toBe(1);
    expect(await test.withUnitOfWork(async () => (await repo()).getEntityChangeCount({ startTime: day2 }))).toBe(2);
    expect((await test.withUnitOfWork(async () => (await repo()).getEntityChangeList({ entityTypeFullName: "Order", sorting: "changeTime asc", maxResultCount: 1 }))).map((c) => c.entityId)).toEqual(["order-2"]);

    const single = await test.withUnitOfWork(async () => (await repo()).getEntityChange(changeIdOfB));
    expect(single).toBeInstanceOf(EntityChange);
    expect(single.propertyChanges[0]?.propertyName).toBe("price");
    await expect(test.withUnitOfWork(async () => (await repo()).getEntityChange(Guid.newGuid()))).rejects.toBeInstanceOf(EntityNotFoundException);

    const withUser = await test.withUnitOfWork(async () => (await repo()).getEntityChangeWithUsername(changeIdOfB));
    expect(withUser.userName).toBe("bob");
    expect(withUser.entityChange.id).toBe(changeIdOfB);

    const history = await test.withUnitOfWork(async () => (await repo()).getEntityChangesWithUsername("order-2", "Order"));
    expect(history.map((h) => [h.userName, h.entityChange.changeType])).toEqual([
      ["bob", EntityChangeType.Deleted],
      ["alice", EntityChangeType.Created],
    ]);
    expect(await test.withUnitOfWork(async () => (await repo()).getEntityChangeCount({ auditLogId: history[0]!.entityChange.auditLogId }))).toBe(2);
  });
});
