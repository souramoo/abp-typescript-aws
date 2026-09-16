import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, ServiceLifetime, Transient, type Guid } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor } from "@abp/security";
import {
  AbpAuditingModule,
  AbpAuditingOptions,
  Audited,
  AuditingEnabled,
  AuditingInterceptorRegistrar,
  AuditLogContributor,
  DisableAuditing,
  EntityChangeType,
  IAuditingHelper,
  IAuditingManager,
  IAuditingStore,
  IAuditPropertySetter,
  IEntityHistoryHelper,
  type AuditLogContributionContext,
  type AuditLogInfo,
  type IFullAuditedObject,
  type IHasEntityVersion,
} from "../src/index.js";

const userId: Guid = "0b7c9d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const tenantId: Guid = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const otherTenantId: Guid = "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function userPrincipal(): ClaimsPrincipal {
  return new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.userName, "john"), new Claim(AbpClaimTypes.tenantId, tenantId), new Claim(AbpClaimTypes.clientId, "web")], "Bearer"));
}

class Secret {
  @DisableAuditing()
  password = "p@ss";
  login = "john";
}

@Transient()
@AuditingEnabled()
class ProductAppService {
  async create(name: string, price: number, secret: Secret, signal: AbortSignal): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return `${name}:${price}:${secret.login}:${signal.aborted}`;
  }

  async getList(): Promise<string[]> {
    return [];
  }

  @DisableAuditing()
  async hidden(): Promise<void> {}

  async fail(): Promise<void> {
    throw new Error("boom");
  }
}

@Transient()
class PlainService {
  async work(): Promise<void> {}

  @Audited()
  async important(): Promise<void> {}
}

@Transient()
class NotAudited {
  async work(): Promise<void> {}
}

class RecordingStore {
  readonly saved: AuditLogInfo[] = [];
  async save(auditInfo: AuditLogInfo): Promise<void> {
    this.saved.push(auditInfo);
  }
}

class TestContributor extends AuditLogContributor {
  override preContribute(context: AuditLogContributionContext): void {
    context.auditInfo.comments.push("pre");
  }
  override postContribute(context: AuditLogContributionContext): void {
    context.auditInfo.extraProperties.set("post", context.auditInfo.actions.length);
  }
}

@Audited()
class Document implements IFullAuditedObject, IHasEntityVersion {
  id = "doc-1";
  title = "";
  @DisableAuditing()
  internalNotes = "";
  creationTime!: Date;
  creatorId: Guid | undefined;
  lastModificationTime: Date | undefined;
  lastModifierId: Guid | undefined;
  isDeleted = false;
  deletionTime: Date | undefined;
  deleterId: Guid | undefined;
  entityVersion = 0;
  tenantId: Guid | undefined;
}

@DependsOn(AbpAuditingModule)
class TestModule extends AbpModule {}

async function createApp(configure?: (options: AbpAuditingOptions) => void) {
  const store = new RecordingStore();
  const app = await AbpApplication.create(TestModule, { applicationName: "TestApp", configuration: { skipDefaults: true } });
  app.services.replace(IAuditingStore, { useValue: store }, ServiceLifetime.Singleton);
  if (configure) app.services.options.configure(AbpAuditingOptions, configure);
  await app.initialize();
  return { app, store };
}

describe("AuditingInterceptor", () => {
  it("records the action with arguments, duration and user info, skipping ignored types and DisableAuditing members", async () => {
    const { app, store } = await createApp();
    expect(AuditingInterceptorRegistrar.shouldIntercept(ProductAppService)).toBe(true);
    expect(AuditingInterceptorRegistrar.shouldIntercept(PlainService)).toBe(true);
    expect(AuditingInterceptorRegistrar.shouldIntercept(NotAudited)).toBe(false);
    expect(app.services.getInterceptors(NotAudited).length).toBe(0);

    const service = app.serviceProvider.getRequired(ProductAppService);
    const principalAccessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    const result = await currentTenant.run(tenantId, "acme", () => principalAccessor.run(userPrincipal(), () => service.create("book", 12.5, new Secret(), new AbortController().signal)));
    expect(result).toBe("book:12.5:john:false");

    expect(store.saved.length).toBe(1);
    const log = store.saved[0]!;
    expect(log.applicationName).toBe("TestApp");
    expect(log.userId).toBe(userId);
    expect(log.userName).toBe("john");
    expect(log.tenantId).toBe(tenantId);
    expect(log.tenantName).toBe("acme");
    expect(log.clientId).toBe("web");
    expect(log.executionDuration).toBeGreaterThanOrEqual(4);
    expect(log.exceptions).toEqual([]);
    expect(log.actions.length).toBe(1);
    const action = log.actions[0]!;
    expect(action.serviceName).toBe("ProductAppService");
    expect(action.methodName).toBe("create");
    expect(action.executionDuration).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(action.parameters)).toEqual({ name: "book", price: 12.5, secret: { login: "john" }, signal: null });
    expect(app.serviceProvider.getRequired(IAuditingManager).current).toBeUndefined();
    await app.shutdown();
  });

  it("records exceptions, rethrows and still saves the log", async () => {
    const { app, store } = await createApp();
    const service = app.serviceProvider.getRequired(ProductAppService);
    await expect(service.fail()).rejects.toThrow("boom");
    expect(store.saved.length).toBe(1);
    expect(store.saved[0]!.exceptions.map((e) => (e as Error).message)).toEqual(["boom"]);
    expect(store.saved[0]!.getExceptionInfos()[0]?.message).toBe("boom");
    expect(store.saved[0]!.toString()).toContain("ProductAppService.fail");
    await app.shutdown();
  });

  it("respects DisableAuditing, Audited methods on plain classes and the get-request rule", async () => {
    const { app, store } = await createApp();
    const helper = app.serviceProvider.getRequired(IAuditingHelper);
    expect(helper.shouldSaveAudit(ProductAppService, "create")).toBe(true);
    expect(helper.shouldSaveAudit(ProductAppService, "hidden")).toBe(false);
    expect(helper.shouldSaveAudit(PlainService, "work")).toBe(false);
    expect(helper.shouldSaveAudit(PlainService, "important")).toBe(true);
    expect(helper.runWithAuditingDisabled(() => helper.shouldSaveAudit(ProductAppService, "create"))).toBe(false);

    const service = app.serviceProvider.getRequired(ProductAppService);
    await service.hidden();
    await service.getList();
    expect(store.saved.length).toBe(0);

    await app.serviceProvider.getRequired(PlainService).important();
    expect(store.saved.length).toBe(1);
    expect(store.saved[0]!.actions[0]?.methodName).toBe("important");
    await app.shutdown();
  });

  it("skips anonymous users when isEnabledForAnonymousUsers is false", async () => {
    const { app, store } = await createApp((options) => {
      options.isEnabledForAnonymousUsers = false;
    });
    const service = app.serviceProvider.getRequired(ProductAppService);
    await service.create("a", 1, new Secret(), new AbortController().signal);
    expect(store.saved.length).toBe(0);

    const principalAccessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    await principalAccessor.run(userPrincipal(), () => service.create("b", 2, new Secret(), new AbortController().signal));
    expect(store.saved.length).toBe(1);
    await app.shutdown();
  });

  it("joins an existing scope and runInScope saves once with contributors and entity changes", async () => {
    const { app, store } = await createApp((options) => {
      options.contributors.push(new TestContributor());
    });
    const manager = app.serviceProvider.getRequired(IAuditingManager);
    const service = app.serviceProvider.getRequired(ProductAppService);
    const history = app.serviceProvider.getRequired(IEntityHistoryHelper);

    await manager.runInScope(async (scope) => {
      await service.create("x", 1, new Secret(), new AbortController().signal);
      await service.create("y", 2, new Secret(), new AbortController().signal);
      expect(manager.current).toBe(scope);
      const doc = new Document();
      doc.tenantId = tenantId;
      const change = history.createEntityChangeInfo(doc, EntityChangeType.Updated, { original: { title: "old", internalNotes: "a" }, current: { title: "new", internalNotes: "b" } });
      expect(history.addToCurrentAuditLog([change!])).toBe(true);
      const second = history.createEntityChangeInfo(doc, EntityChangeType.Updated, { original: { title: "new" }, current: { title: "newer" } });
      history.addToCurrentAuditLog([second!]);
    });

    expect(store.saved.length).toBe(1);
    const log = store.saved[0]!;
    expect(log.actions.map((a) => a.methodName)).toEqual(["create", "create"]);
    expect(log.comments).toEqual(["pre"]);
    expect(log.extraProperties.get("post")).toBe(2);
    expect(log.entityChanges.length).toBe(1);
    const change = log.entityChanges[0]!;
    expect(change.entityTypeFullName).toBe("Document");
    expect(change.entityId).toBe("doc-1");
    expect(change.entityTenantId).toBe(tenantId);
    expect(change.propertyChanges.map((p) => [p.propertyName, p.originalValue, p.newValue])).toEqual([["title", "old", "newer"]]);
    expect(manager.current).toBeUndefined();
    await app.shutdown();
  });

  it("runInScope records a thrown error and rethrows", async () => {
    const { app, store } = await createApp();
    const manager = app.serviceProvider.getRequired(IAuditingManager);
    await expect(
      manager.runInScope(async () => {
        throw new Error("scoped");
      }),
    ).rejects.toThrow("scoped");
    expect(store.saved[0]!.exceptions.map((e) => (e as Error).message)).toEqual(["scoped"]);
    await app.shutdown();
  });
});

describe("AuditPropertySetter", () => {
  it("sets creation, modification and deletion properties from the current user and clock", async () => {
    const { app } = await createApp();
    const setter = app.serviceProvider.getRequired(IAuditPropertySetter);
    const principalAccessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const before = Date.now();

    const doc = new Document();
    doc.tenantId = tenantId;
    principalAccessor.run(userPrincipal(), () => {
      setter.setCreationProperties(doc);
      setter.setModificationProperties(doc);
      setter.setDeletionProperties(doc);
      setter.incrementEntityVersionProperty(doc);
    });
    expect(doc.creationTime.getTime()).toBeGreaterThanOrEqual(before);
    expect(doc.creatorId).toBe(userId);
    expect(doc.lastModificationTime).toBeInstanceOf(Date);
    expect(doc.lastModifierId).toBe(userId);
    expect(doc.deletionTime).toBeInstanceOf(Date);
    expect(doc.deleterId).toBe(userId);
    expect(doc.entityVersion).toBe(1);

    const creationTime = doc.creationTime;
    principalAccessor.run(userPrincipal(), () => setter.setCreationProperties(doc));
    expect(doc.creationTime).toBe(creationTime);

    const foreign = new Document();
    foreign.tenantId = otherTenantId;
    principalAccessor.run(userPrincipal(), () => {
      setter.setCreationProperties(foreign);
      setter.setModificationProperties(foreign);
    });
    expect(foreign.creatorId).toBeUndefined();
    expect(foreign.lastModifierId).toBeUndefined();

    const anonymous = new Document();
    anonymous.lastModifierId = userId;
    setter.setModificationProperties(anonymous);
    setter.setCreationProperties(anonymous);
    expect(anonymous.lastModifierId).toBeUndefined();
    expect(anonymous.creatorId).toBeUndefined();
    expect(app.serviceProvider.getRequired(ICurrentTenant).id).toBeUndefined();
    await app.shutdown();
  });
});
