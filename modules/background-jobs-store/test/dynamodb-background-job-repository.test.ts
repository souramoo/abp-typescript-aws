import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Guid, NullLoggerFactory, type IServiceProvider } from "@abp/core";
import { AbpBackgroundJobOptions, BackgroundJobInfo, BackgroundJobNameFilter, BackgroundJobPriority, IBackgroundJobStore } from "@abp/background-jobs";
import { IUnitOfWorkManager } from "@abp/uow";
import { BackgroundJobRecord, BackgroundJobStore, IBackgroundJobRepository } from "../src/domain/index.js";
import { AbpBackgroundJobsDynamoDbModule, BackgroundJobsDbContext, DynamoDbBackgroundJobRepository } from "../src/dynamodb/index.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);

@DependsOn(AbpBackgroundJobsDynamoDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpBackgroundJobOptions, (options) => {
      options.isJobExecutionEnabled = false;
    });
  }
}

let app: AbpApplication;
let provider: IServiceProvider;
const items: Record<string, unknown>[] = [];

beforeAll(async () => {
  app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { ConnectionStrings: { Default: "jobs-table" } } }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  provider = app.serviceProvider;
});
afterAll(() => app.shutdown());

beforeEach(() => {
  items.length = 0;
  documentClientMock.reset();
  documentClientMock.on(PutCommand).callsFake((input: { Item: Record<string, unknown> }) => {
    items.push(input.Item);
    return {};
  });
  documentClientMock.on(TransactWriteCommand).resolves({});
  documentClientMock.on(DeleteCommand).resolves({});
  documentClientMock.on(GetCommand).resolves({});
  documentClientMock.on(QueryCommand).callsFake(() => ({ Items: items }));
});

async function withUow<T>(fn: () => Promise<T>): Promise<T> {
  const uow = provider.getRequired(IUnitOfWorkManager).begin({ isTransactional: false }, true);
  try {
    const result = await fn();
    await uow.complete();
    return result;
  } finally {
    await uow.dispose();
  }
}

const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("DynamoDbBackgroundJobRepository", () => {
  it("is the IBackgroundJobRepository behind the store and owns the AbpBackgroundJobs entity", () => {
    expect(provider.getRequired(IBackgroundJobRepository)).toBeInstanceOf(DynamoDbBackgroundJobRepository);
    expect(provider.getRequired(IBackgroundJobStore)).toBeInstanceOf(BackgroundJobStore);
    const configuration = provider.getRequired(BackgroundJobsDbContext).getEntityConfiguration(BackgroundJobRecord);
    expect(configuration.name).toBe("AbpBackgroundJobs");
    expect(configuration.indexes.map((i) => i.index)).toEqual(["gsi2", "gsi3"]);
  });

  it("writes waiting jobs into gsi2 (waiting#<app> / nextTryTime) and drops completed or abandoned ones from it", async () => {
    const store = provider.getRequired(IBackgroundJobStore);
    const nextTryTime = new Date("2026-05-01T10:00:00Z");
    const waiting = new BackgroundJobInfo({ id: Guid.newGuid(), applicationName: "app", jobName: "Job", jobArgs: "{}", creationTime: nextTryTime, nextTryTime, priority: BackgroundJobPriority.High });
    await withUow(() => store.insert(waiting));
    expect(items[0]).toMatchObject({ pk: `host#AbpBackgroundJobs#${waiting.id}`, sk: "AbpBackgroundJobs", gsi2pk: "host#AbpBackgroundJobs#waiting#app", gsi2sk: "2026-05-01T10:00:00.000Z", jobName: "Job", priority: BackgroundJobPriority.High });
    expect(items[0]!["gsi3pk"]).toBeUndefined();

    const completed = new BackgroundJobInfo({ id: Guid.newGuid(), applicationName: "app", jobName: "Job", jobArgs: "{}", creationTime: nextTryTime, nextTryTime, completionTime: new Date("2026-05-02T00:00:00Z") });
    await withUow(() => store.insert(completed));
    expect(items[1]!["gsi2pk"]).toBeUndefined();
    expect(items[1]).toMatchObject({ gsi3pk: "host#AbpBackgroundJobs#completed#app", gsi3sk: "2026-05-02T00:00:00.000Z" });

    const abandoned = new BackgroundJobInfo({ id: Guid.newGuid(), applicationName: undefined, jobName: "Job", jobArgs: "{}", creationTime: nextTryTime, nextTryTime, isAbandoned: true });
    await withUow(() => store.insert(abandoned));
    expect(items[2]!["gsi2pk"]).toBeUndefined();
  });

  it("queries gsi2 for the due jobs and orders them by priority, tryCount and nextTryTime", async () => {
    const store = provider.getRequired(IBackgroundJobStore);
    const base = { applicationName: "app", jobArgs: "{}", creationTime: new Date("2026-05-01T00:00:00Z"), nextTryTime: new Date("2026-05-01T00:00:00Z") };
    const low = new BackgroundJobInfo({ ...base, id: Guid.newGuid(), jobName: "LowJob", priority: BackgroundJobPriority.Low });
    const retried = new BackgroundJobInfo({ ...base, id: Guid.newGuid(), jobName: "NormalJob", tryCount: 3 });
    const fresh = new BackgroundJobInfo({ ...base, id: Guid.newGuid(), jobName: "NormalJob", nextTryTime: new Date("2026-05-01T01:00:00Z") });
    for (const info of [low, retried, fresh]) await withUow(() => store.insert(info));
    documentClientMock.resetHistory();

    const waiting = await withUow(() => store.getWaitingJobs("app", 10));
    expect(waiting.map((j) => j.id)).toEqual([fresh.id, retried.id, low.id]);
    expect(waiting[0]).toBeInstanceOf(BackgroundJobInfo);
    expect(waiting[0]!.nextTryTime).toEqual(new Date("2026-05-01T01:00:00Z"));

    const query = documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input as QueryCommandInput;
    expect(query).toMatchObject({
      TableName: "jobs-table",
      IndexName: "gsi2",
      KeyConditionExpression: "#pk = :pk AND #sk <= :sk",
      ExpressionAttributeNames: { "#pk": "gsi2pk", "#sk": "gsi2sk" },
      ScanIndexForward: true,
    });
    expect(query.ExpressionAttributeValues?.[":pk"]).toBe("host#AbpBackgroundJobs#waiting#app");
    expect(query.ExpressionAttributeValues?.[":sk"]).toMatch(isoDate);
    expect(query.FilterExpression).toBe("attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted");

    expect((await withUow(() => store.getWaitingJobs("app", 1, BackgroundJobNameFilter.exclude(["NormalJob"])))).map((j) => j.id)).toEqual([low.id]);
  });

  it("deletes completed jobs through a limited gsi3 query", async () => {
    const store = provider.getRequired(IBackgroundJobStore);
    const done = new BackgroundJobInfo({ id: Guid.newGuid(), applicationName: "app", jobName: "Job", jobArgs: "{}", creationTime: new Date("2026-01-01T00:00:00Z"), nextTryTime: new Date("2026-01-01T00:00:00Z"), completionTime: new Date("2026-01-01T00:00:00Z") });
    await withUow(() => store.insert(done));
    documentClientMock.resetHistory();

    expect(await withUow(() => store.deleteCompleted("app", new Date("2026-02-01T00:00:00Z"), 5))).toBe(1);
    const query = documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input as QueryCommandInput;
    expect(query).toMatchObject({ IndexName: "gsi3", KeyConditionExpression: "#pk = :pk AND #sk < :sk", Limit: 5, ExpressionAttributeValues: { ":pk": "host#AbpBackgroundJobs#completed#app", ":sk": "2026-02-01T00:00:00.000Z" } });
    const deletes = documentClientMock.commandCalls(DeleteCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.args[0].input.Key).toEqual({ pk: `host#AbpBackgroundJobs#${done.id}`, sk: "AbpBackgroundJobs" });
  });
});
