import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, BusinessException, DependsOn, NullLoggerFactory } from "@abp/core";
import { distributedCacheToken } from "@abp/caching";
import { ILocalEventBus } from "@abp/event-bus";
import { ITenantStore, TenantChangedEvent, TenantConfiguration } from "@abp/multi-tenancy-abstractions";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpTenantManagementDomainModule, ITenantManager, ITenantRepository, Tenant, TenantConfigurationCacheItem, TenantStore } from "../src/domain/index.js";
import { TenantManagementErrorCodes } from "../src/domain-shared/index.js";
import { AbpTenantManagementMemoryDbModule } from "../src/memory-db/index.js";

@DependsOn(AbpTenantManagementDomainModule, AbpTenantManagementMemoryDbModule)
class TestModule extends AbpModule {}

const test = createAbpIntegratedTest(TestModule, {
  setAbpApplicationCreationOptions: (options) => {
    options.loggerFactory = NullLoggerFactory.instance;
  },
});

beforeAll(() => test.initialize());
afterAll(() => test.dispose());

describe("TenantManager", () => {
  it("creates tenants with a normalized name and rejects duplicates", async () => {
    const tenant = await test.withUnitOfWork(async (provider) => {
      const created = await provider.getRequired(ITenantManager).create("Acme");
      await provider.getRequired(ITenantRepository).insert(created);
      return created;
    });
    expect(tenant).toBeInstanceOf(Tenant);
    expect(tenant.normalizedName).toBe("ACME");
    expect(tenant.entityVersion).toBe(0);

    const error = await test.withUnitOfWork((provider) => provider.getRequired(ITenantManager).create("acme").catch((e: unknown) => e));
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).code).toBe(TenantManagementErrorCodes.DuplicateTenantName);
    expect((error as BusinessException).data).toEqual({ Name: "ACME" });
  });

  it("changes the name after publishing TenantChangedEvent for the old name", async () => {
    const events: TenantChangedEvent[] = [];
    using _ = test.rootServiceProvider.getRequired(ILocalEventBus).subscribe(TenantChangedEvent, (e) => void events.push(e));

    const tenant = await test.withUnitOfWork(async (provider) => {
      const repository = provider.getRequired(ITenantRepository);
      const created = await repository.insert(await provider.getRequired(ITenantManager).create("Rename me"));
      await provider.getRequired(ITenantManager).changeName(created, "Renamed");
      await repository.update(created);
      return created;
    });

    expect(tenant.name).toBe("Renamed");
    expect(tenant.normalizedName).toBe("RENAMED");
    expect(events).toEqual([new TenantChangedEvent(tenant.id, "RENAME ME")]);
    await expect(test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).findByName("RENAMED"))).resolves.toMatchObject({ id: tenant.id });
    await expect(test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).findByName("RENAME ME"))).resolves.toBeUndefined();
  });

  it("lists with filter, sorting and paging and counts with the filter", async () => {
    await test.withUnitOfWork(async (provider) => {
      const repository = provider.getRequired(ITenantRepository);
      const manager = provider.getRequired(ITenantManager);
      for (const name of ["Zeta Corp", "Beta Corp", "Alpha Inc"]) await repository.insert(await manager.create(name));
    });

    const corps = await test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).getList(undefined, 10, 0, "Corp"));
    expect(corps.map((t) => t.name)).toEqual(["Beta Corp", "Zeta Corp"]);
    const paged = await test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).getList("name desc", 1, 1, "Corp"));
    expect(paged.map((t) => t.name)).toEqual(["Beta Corp"]);
    await expect(test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).getCount("Corp"))).resolves.toBe(2);
    await expect(test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).getCount())).resolves.toBeGreaterThanOrEqual(5);
    await expect(test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).getList())).resolves.toHaveLength(await test.withUnitOfWork((provider) => provider.getRequired(ITenantRepository).getCount()));
  });
});

describe("TenantStore", () => {
  it("replaces DefaultTenantStore and finds tenants by id and by normalized name through the cache", async () => {
    const store = test.getRequiredService(ITenantStore);
    expect(store).toBeInstanceOf(TenantStore);

    const tenant = await test.withUnitOfWork(async (provider) => {
      const created = await provider.getRequired(ITenantManager).create("Volosoft");
      created.setDefaultConnectionString("Server=volosoft");
      created.setConnectionString("Reporting", "Server=reports");
      return provider.getRequired(ITenantRepository).insert(created);
    });

    const byId = await test.withUnitOfWork(() => store.findById(tenant.id));
    expect(byId).toBeInstanceOf(TenantConfiguration);
    expect(byId).toMatchObject({ id: tenant.id, name: "Volosoft", normalizedName: "VOLOSOFT", isActive: true });
    expect(byId?.connectionStrings?.default).toBe("Server=volosoft");
    expect(byId?.connectionStrings?.getOrDefault("Reporting")).toBe("Server=reports");

    const cache = test.getRequiredService(distributedCacheToken(TenantConfigurationCacheItem));
    const cached = await cache.get(TenantConfigurationCacheItem.calculateCacheKey(tenant.id, undefined));
    expect(cached).toBeInstanceOf(TenantConfigurationCacheItem);
    expect(cached?.value).toBeInstanceOf(TenantConfiguration);
    expect(cached?.value?.connectionStrings?.default).toBe("Server=volosoft");

    const byName = await test.withUnitOfWork(() => store.findByName("VOLOSOFT"));
    expect(byName?.id).toBe(tenant.id);
    expect((await test.withUnitOfWork(() => store.find(tenant.id)))?.name).toBe("Volosoft");
    expect((await test.withUnitOfWork(() => store.find("VOLOSOFT")))?.name).toBe("Volosoft");
    expect(await test.withUnitOfWork(() => store.findByName("NOBODY"))).toBeUndefined();
    expect((await test.withUnitOfWork(() => store.getList())).some((t) => t.id === tenant.id)).toBe(true);
  });

  it("invalidates the cached configuration when the tenant changes", async () => {
    const store = test.getRequiredService(ITenantStore);
    const cache = test.getRequiredService(distributedCacheToken(TenantConfigurationCacheItem));

    const tenant = await test.withUnitOfWork(async (provider) => provider.getRequired(ITenantRepository).insert(await provider.getRequired(ITenantManager).create("Cached")));
    expect((await test.withUnitOfWork(() => store.findByName("CACHED")))?.name).toBe("Cached");
    expect(await cache.get(TenantConfigurationCacheItem.calculateCacheKey(undefined, "CACHED"))).toBeDefined();

    await test.withUnitOfWork(async (provider) => {
      const repository = provider.getRequired(ITenantRepository);
      const loaded = await repository.get(tenant.id);
      await provider.getRequired(ITenantManager).changeName(loaded, "Refreshed");
      loaded.setDefaultConnectionString("Server=new");
      await repository.update(loaded);
    });

    expect(await cache.get(TenantConfigurationCacheItem.calculateCacheKey(undefined, "CACHED"))).toBeUndefined();
    expect(await cache.get(TenantConfigurationCacheItem.calculateCacheKey(tenant.id, undefined))).toBeUndefined();
    expect(await test.withUnitOfWork(() => store.findByName("CACHED"))).toBeUndefined();
    const refreshed = await test.withUnitOfWork(() => store.findById(tenant.id));
    expect(refreshed?.name).toBe("Refreshed");
    expect(refreshed?.connectionStrings?.default).toBe("Server=new");
  });
});
