import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { IDistributedCacheStore, MemoryDistributedCacheStore } from "@abp/caching";
import { IFeatureChecker, IFeatureStore } from "@abp/features";
import { memoryDatabaseProviderToken } from "@abp/memory-db";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpFeatureManagementDomainModule, FeatureManagerExtensions, FeatureStore, FeatureValue, IFeatureManager, IFeatureValueRepository } from "../src/domain/index.js";
import { FeatureManagementDomainErrorCodes, FeatureValueInvalidException } from "../src/domain-shared/index.js";
import { AbpFeatureManagementMemoryDbModule, FeatureManagementMemoryDbContext } from "../src/memory-db/index.js";
import { TestFeatures, creationOptions, editionA, tenantA, tenantB } from "./test-support.js";
import "./test-support.js";

@DependsOn(AbpFeatureManagementDomainModule, AbpFeatureManagementMemoryDbModule)
class TestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.replaceSingleton(IDistributedCacheStore, { useValue: new MemoryDistributedCacheStore() });
  }
}

const test = createAbpIntegratedTest(TestModule, { setAbpApplicationCreationOptions: creationOptions });
beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const manager = () => test.getRequiredService(IFeatureManager);
const currentTenant = () => test.getRequiredService(ICurrentTenant);

describe("FeatureManager", () => {
  it("validates values against the feature's value type before storing them", async () => {
    const m = manager();
    await FeatureManagerExtensions.setForTenant(m, tenantA, TestFeatures.Boolean, "true");
    expect(await FeatureManagerExtensions.getOrNullForTenant(m, TestFeatures.Boolean, tenantA)).toBe("true");

    await expect(FeatureManagerExtensions.setForTenant(m, tenantA, TestFeatures.Boolean, "maybe")).rejects.toBeInstanceOf(FeatureValueInvalidException);
    await expect(FeatureManagerExtensions.setForTenant(m, tenantA, TestFeatures.Number, "150")).rejects.toMatchObject({ code: FeatureManagementDomainErrorCodes.FeatureValueInvalid, data: { "0": "Test.Number" } });
    await FeatureManagerExtensions.setForTenant(m, tenantA, TestFeatures.Number, "50");
    expect(await FeatureManagerExtensions.getOrNullForTenant(m, TestFeatures.Number, tenantA)).toBe("50");
    await expect(m.set("Test.Unknown", "x", "T", tenantA)).rejects.toThrow(/Undefined feature/);
  });

  it("falls back to the default value and clears a value equal to its fallback unless forced", async () => {
    const m = manager();
    expect(await FeatureManagerExtensions.getOrNullForTenant(m, TestFeatures.Number, tenantB)).toBe("10");
    expect(await FeatureManagerExtensions.getOrNullForTenant(m, TestFeatures.Number, tenantB, false)).toBe("10");

    await FeatureManagerExtensions.setForTenant(m, tenantB, TestFeatures.Number, "10");
    expect((await FeatureManagerExtensions.getOrNullWithProviderForTenant(m, TestFeatures.Number, tenantB)).provider).toMatchObject({ name: "D", key: undefined });

    await FeatureManagerExtensions.setForTenant(m, tenantB, TestFeatures.Number, "10", true);
    expect((await FeatureManagerExtensions.getOrNullWithProviderForTenant(m, TestFeatures.Number, tenantB)).provider).toMatchObject({ name: "T", key: tenantB });

    await expect(FeatureManagerExtensions.setForTenant(m, tenantB, TestFeatures.Number, undefined)).rejects.toBeInstanceOf(FeatureValueInvalidException);
    await m.delete("T", tenantB);
    expect((await FeatureManagerExtensions.getOrNullWithProviderForTenant(m, TestFeatures.Number, tenantB)).provider?.name).toBe("D");
  });

  it("resolves a tenant's edition values through the edition provider", async () => {
    const m = manager();
    await FeatureManagerExtensions.setForEdition(m, editionA, TestFeatures.EditionOnly, "premium");
    expect(await FeatureManagerExtensions.getOrNullForEdition(m, TestFeatures.EditionOnly, editionA)).toBe("premium");

    const forTenant = await FeatureManagerExtensions.getOrNullWithProviderForTenant(m, TestFeatures.EditionOnly, tenantA);
    expect(forTenant).toMatchObject({ value: "premium", provider: { name: "E", key: tenantA } });
    expect(await FeatureManagerExtensions.getOrNullForTenant(m, TestFeatures.EditionOnly, tenantB)).toBe("edition");
    await expect(FeatureManagerExtensions.setForTenant(m, tenantA, TestFeatures.EditionOnly, "x")).rejects.toThrow(/not compatible with the provider named 'T'/);
    await expect(m.set(TestFeatures.Boolean, "true", "X", undefined)).rejects.toThrow(/Unknown feature value provider: X/);
  });

  it("lists the granted providers and deletes a provider's values", async () => {
    const m = manager();
    await FeatureManagerExtensions.setForTenant(m, tenantA, TestFeatures.Boolean, "true");
    const all = await FeatureManagerExtensions.getAllWithProviderForTenant(m, tenantA);
    expect(all.find((f) => f.name === TestFeatures.Boolean)).toMatchObject({ value: "true", provider: { name: "T", key: tenantA } });
    expect(all.find((f) => f.name === TestFeatures.BooleanChild)).toMatchObject({ value: "false", provider: { name: "D" } });
    expect((await FeatureManagerExtensions.getAllForTenant(m, tenantA, false)).map((f) => f.name).sort()).toEqual([TestFeatures.Boolean, TestFeatures.Number]);

    await m.delete("T", tenantA);
    expect(await FeatureManagerExtensions.getAllForTenant(m, tenantA, false)).toEqual([]);
    expect(await FeatureManagerExtensions.getOrNullForTenant(m, TestFeatures.Boolean, tenantA)).toBe("false");
  });
});

describe("FeatureStore", () => {
  it("replaces NullFeatureStore so IFeatureChecker sees the managed values of the current tenant", async () => {
    expect(test.getRequiredService(IFeatureStore)).toBeInstanceOf(FeatureStore);
    await FeatureManagerExtensions.setForTenant(manager(), tenantA, TestFeatures.Boolean, "true");
    const checker = test.getRequiredService(IFeatureChecker);
    expect(await checker.isEnabled(TestFeatures.Boolean)).toBe(false);
    expect(await currentTenant().run(tenantA, undefined, () => checker.isEnabled(TestFeatures.Boolean))).toBe(true);
    expect(await currentTenant().run(tenantB, undefined, () => checker.isEnabled(TestFeatures.Boolean))).toBe(false);
  });

  it("serves values from the distributed cache and invalidates them when the entity changes", async () => {
    await FeatureManagerExtensions.setForTenant(manager(), tenantA, TestFeatures.Number, "42");
    const checker = test.getRequiredService(IFeatureChecker);
    const read = () => currentTenant().run(tenantA, undefined, () => checker.getOrNull(TestFeatures.Number));
    expect(await read()).toBe("42");
    const cacheStore = test.getRequiredService(IDistributedCacheStore) as MemoryDistributedCacheStore;
    expect(await cacheStore.get(`c:FeatureValue,k:pn:T,pk:${tenantA},n:Test.Number`)).toBeDefined();

    await test.withUnitOfWork(async (provider) => {
      const database = await provider.getRequired(memoryDatabaseProviderToken(FeatureManagementMemoryDbContext)).getDatabase();
      const collection = database.collection(FeatureValue);
      const entity = [...collection].find((f) => f.name === TestFeatures.Number && f.providerKey === tenantA)!;
      entity.value = "43";
      collection.update(entity);
    });
    expect(await read()).toBe("42");

    const repository = test.getRequiredService(IFeatureValueRepository);
    const entity = (await repository.find(TestFeatures.Number, "T", tenantA))!;
    entity.value = "44";
    await repository.update(entity, true);
    expect(await cacheStore.get(`c:FeatureValue,k:pn:T,pk:${tenantA},n:Test.Number`)).toBeUndefined();
    expect(await read()).toBe("44");
  });
});
