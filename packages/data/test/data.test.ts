import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Transient, delay } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import {
  AbpDataFilterOptions,
  AbpDataModule,
  AbpDataSeedOptions,
  AbpDbConnectionOptions,
  ConnectionStringName,
  DataFilterState,
  DataSeedContext,
  DataSeedContributor,
  IConnectionStringResolver,
  IDataFilter,
  IDataSeeder,
  MultiTenantFilter,
  SoftDeleteFilter,
  createDataFilterKey,
  getConnectionStringName,
  resolveConnectionStringFor,
  seedInSeparateUow,
  type IDataSeedContributor,
} from "../src/index.js";

const seedLog: string[] = [];

@Transient()
@DataSeedContributor()
class FirstSeeder implements IDataSeedContributor {
  static readonly inject = [ICurrentTenant, IUnitOfWorkManager] as const;
  constructor(
    private readonly currentTenant: ICurrentTenant,
    private readonly unitOfWorkManager: IUnitOfWorkManager,
  ) {}
  async seed(context: DataSeedContext): Promise<void> {
    const uow = this.unitOfWorkManager.current;
    uow?.onCompleted(() => {
      seedLog.push("first:completed");
    });
    seedLog.push(`first:${String(this.currentTenant.id)}:${String(context.get("AdminEmail"))}:${uow?.id ?? "no-uow"}`);
  }
}

@Transient()
@DataSeedContributor()
class SecondSeeder implements IDataSeedContributor {
  static readonly inject = [IUnitOfWorkManager] as const;
  constructor(private readonly unitOfWorkManager: IUnitOfWorkManager) {}
  async seed(): Promise<void> {
    seedLog.push(`second:${this.unitOfWorkManager.current?.id ?? "no-uow"}`);
  }
}

@ConnectionStringName("AbpIdentity")
class IdentityDbContext {}
class TenantManagementDbContext {}

const AuditFilter = createDataFilterKey("IAuditLog");

@DependsOn(AbpDataModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpDataFilterOptions, (o) => {
      o.defaultStates.set(AuditFilter, new DataFilterState(false));
    });
    this.configure(AbpDbConnectionOptions, (o) => {
      o.databases.configure("MainDb", (db) => db.mapConnection("TenantManagementDbContext", "AbpSettingManagement"));
    });
  }
}

async function createApp() {
  const app = await AbpApplication.create(TestModule, {
    configuration: { skipDefaults: true, values: { ConnectionStrings: { Default: "Table=Default", AbpIdentity: "Table=Identity", MainDb: "Table=Main" } } },
  });
  await app.initialize();
  return app;
}

const tenantId = "11111111-1111-4111-8111-111111111111";

describe("IDataFilter", () => {
  it("nests enable/disable scopes and honours default states", async () => {
    const app = await createApp();
    const dataFilter = app.serviceProvider.getRequired(IDataFilter);
    expect(dataFilter.isEnabled(SoftDeleteFilter)).toBe(true);
    expect(dataFilter.isEnabled(AuditFilter)).toBe(false);
    expect(createDataFilterKey("ISoftDelete")).toBe(SoftDeleteFilter);

    const outer = dataFilter.disable(SoftDeleteFilter, MultiTenantFilter);
    expect(dataFilter.isEnabled(SoftDeleteFilter)).toBe(false);
    expect(dataFilter.isEnabled(MultiTenantFilter)).toBe(false);
    const inner = dataFilter.enable(SoftDeleteFilter);
    expect(dataFilter.for(SoftDeleteFilter).isEnabled).toBe(true);
    expect(dataFilter.isEnabled(MultiTenantFilter)).toBe(false);
    inner[Symbol.dispose]();
    expect(dataFilter.isEnabled(SoftDeleteFilter)).toBe(false);
    outer[Symbol.dispose]();
    expect(dataFilter.isEnabled(SoftDeleteFilter)).toBe(true);
    expect(dataFilter.isEnabled(MultiTenantFilter)).toBe(true);

    const noop = dataFilter.enable(SoftDeleteFilter);
    noop[Symbol.dispose]();
    expect(dataFilter.isEnabled(SoftDeleteFilter)).toBe(true);
    await app.shutdown();
  });

  it("runDisabled isolates concurrent async flows", async () => {
    const app = await createApp();
    const dataFilter = app.serviceProvider.getRequired(IDataFilter);
    const [a, b] = await Promise.all([
      dataFilter.runDisabled(SoftDeleteFilter, async () => {
        await delay(5);
        return dataFilter.isEnabled(SoftDeleteFilter);
      }),
      (async () => {
        await delay(1);
        return dataFilter.isEnabled(SoftDeleteFilter);
      })(),
    ]);
    expect(a).toBe(false);
    expect(b).toBe(true);
    expect(dataFilter.runEnabled([AuditFilter, SoftDeleteFilter], () => dataFilter.isEnabled(AuditFilter))).toBe(true);
    expect(dataFilter.isEnabled(AuditFilter)).toBe(false);
    await app.shutdown();
  });
});

describe("IDataSeeder", () => {
  it("runs auto-registered contributors in order inside a tenant scope and a unit of work", async () => {
    seedLog.length = 0;
    const app = await createApp();
    expect(app.serviceProvider.getOptions(AbpDataSeedOptions).contributors.toArray()).toEqual([FirstSeeder, SecondSeeder]);
    const seeder = app.serviceProvider.getRequired(IDataSeeder);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    await seeder.seed(new DataSeedContext(tenantId).withProperty("AdminEmail", "admin@abp.io"));

    expect(seedLog).toHaveLength(3);
    const [first, second, completed] = seedLog;
    expect(first).toMatch(new RegExp(`^first:${tenantId}:admin@abp.io:[0-9a-f-]{36}$`));
    const uowId = first!.split(":").at(-1);
    expect(second).toBe(`second:${uowId}`);
    expect(completed).toBe("first:completed");
    expect(currentTenant.id).toBeUndefined();
    expect(app.serviceProvider.getRequired(IUnitOfWorkManager).current).toBeUndefined();

    seedLog.length = 0;
    await seedInSeparateUow(seeder);
    expect(seedLog[0]).toMatch(/^first:undefined:undefined:/);
    expect(seedLog[0]!.split(":").at(-1)).not.toBe(seedLog[2]!.split(":").at(-1));
    await app.shutdown();
  });
});

describe("IConnectionStringResolver", () => {
  it("resolves by name, database mapping, then default", async () => {
    const app = await createApp();
    const resolver = app.serviceProvider.getRequired(IConnectionStringResolver);
    expect(await resolver.resolve()).toBe("Table=Default");
    expect(await resolver.resolve("AbpIdentity")).toBe("Table=Identity");
    expect(await resolver.resolve("AbpSettingManagement")).toBe("Table=Main");
    expect(await resolver.resolve("Unknown")).toBe("Table=Default");
    expect(getConnectionStringName(IdentityDbContext)).toBe("AbpIdentity");
    expect(getConnectionStringName(TenantManagementDbContext)).toBe("TenantManagementDbContext");
    expect(await resolveConnectionStringFor(resolver, IdentityDbContext)).toBe("Table=Identity");
    expect(await resolveConnectionStringFor(resolver, TenantManagementDbContext)).toBe("Table=Main");
    await app.shutdown();
  });
});
