import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { IDistributedCacheStore, MemoryDistributedCacheStore } from "@abp/caching";
import { memoryDatabaseProviderToken } from "@abp/memory-db";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor } from "@abp/security";
import { ISettingProvider, ISettingStore } from "@abp/settings";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpSettingManagementDomainModule, ISettingManager, ISettingRepository, Setting, SettingManagerExtensions, SettingStore } from "../src/domain/index.js";
import { AbpSettingManagementMemoryDbModule, SettingManagementMemoryDbContext } from "../src/memory-db/index.js";
import { TestSettingNames, creationOptions, tenantA, tenantB, userId } from "./test-support.js";
import "./test-support.js";

@DependsOn(AbpSettingManagementDomainModule, AbpSettingManagementMemoryDbModule)
class TestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.replaceSingleton(IDistributedCacheStore, { useValue: new MemoryDistributedCacheStore() });
  }
}

const test = createAbpIntegratedTest(TestModule, { setAbpApplicationCreationOptions: creationOptions });
beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const manager = () => test.getRequiredService(ISettingManager);
const settingProvider = () => test.getRequiredService(ISettingProvider);
const currentTenant = () => test.getRequiredService(ICurrentTenant);
const user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId)], "Test"));

describe("SettingManager", () => {
  it("resolves values from default → global → tenant → user, the most specific provider winning", async () => {
    const m = manager();
    expect(await SettingManagerExtensions.getOrNullForUser(m, TestSettingNames.Color, userId)).toBe("red");

    await SettingManagerExtensions.setGlobal(m, TestSettingNames.Color, "blue");
    expect(await SettingManagerExtensions.getOrNullGlobal(m, TestSettingNames.Color)).toBe("blue");
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantA)).toBe("blue");
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantA, false)).toBeUndefined();

    await SettingManagerExtensions.setForTenant(m, tenantA, TestSettingNames.Color, "green");
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantA)).toBe("green");
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantB)).toBe("blue");

    await currentTenant().run(tenantA, undefined, async () => {
      expect(await SettingManagerExtensions.getOrNullForUser(m, TestSettingNames.Color, userId)).toBe("green");
      await SettingManagerExtensions.setForUser(m, userId, TestSettingNames.Color, "yellow");
      expect(await SettingManagerExtensions.getOrNullForUser(m, TestSettingNames.Color, userId)).toBe("yellow");
      expect(await SettingManagerExtensions.getOrNullForCurrentTenant(m, TestSettingNames.Color)).toBe("green");
    });

    expect(await SettingManagerExtensions.getOrNullDefault(m, TestSettingNames.Color)).toBe("red");
  });

  it("clears a value equal to its fallback instead of storing it, unless forced", async () => {
    const m = manager();
    await SettingManagerExtensions.setGlobal(m, TestSettingNames.Color, "blue");
    await SettingManagerExtensions.setForTenant(m, tenantB, TestSettingNames.Color, "BLUE");
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantB, false)).toBeUndefined();

    await SettingManagerExtensions.setForTenant(m, tenantB, TestSettingNames.Color, "blue", true);
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantB, false)).toBe("blue");

    await SettingManagerExtensions.setForTenant(m, tenantB, TestSettingNames.Color, undefined);
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantB, false)).toBeUndefined();
  });

  it("honours the allowed providers and the inheritance flag of a definition", async () => {
    const m = manager();
    await expect(m.set(TestSettingNames.GlobalOnly, "x", "T", tenantA)).rejects.toThrow(/not compatible with the provider named 'T'/);
    await expect(m.set(TestSettingNames.Color, "x", "X", undefined)).rejects.toThrow(/Unknown setting value provider: X/);
    await expect(m.set("Test.Unknown", "x", "G", undefined)).rejects.toThrow(/Undefined setting/);

    await SettingManagerExtensions.setGlobal(m, TestSettingNames.NotInherited, "global-value");
    expect(await SettingManagerExtensions.getOrNullGlobal(m, TestSettingNames.NotInherited)).toBe("global-value");
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.NotInherited, tenantA)).toBeUndefined();
  });

  it("stores encrypted settings encrypted and returns them decrypted", async () => {
    const m = manager();
    await SettingManagerExtensions.setGlobal(m, TestSettingNames.Secret, "s3cret");
    const stored = await test.getRequiredService(ISettingRepository).find(TestSettingNames.Secret, "G", undefined);
    expect(stored?.value).toBeDefined();
    expect(stored?.value).not.toBe("s3cret");
    expect(await SettingManagerExtensions.getOrNullGlobal(m, TestSettingNames.Secret)).toBe("s3cret");
  });

  it("lists all values of a provider with and without fallback, and deletes a provider's values", async () => {
    const m = manager();
    await SettingManagerExtensions.setGlobal(m, TestSettingNames.Color, "blue");
    await SettingManagerExtensions.setForTenant(m, tenantA, TestSettingNames.Color, "green");

    const withFallback = await SettingManagerExtensions.getAllForTenant(m, tenantA);
    expect(withFallback.find((v) => v.name === TestSettingNames.Color)?.value).toBe("green");
    expect(withFallback.find((v) => v.name === TestSettingNames.GlobalOnly)?.value).toBe("global");

    const ownOnly = await SettingManagerExtensions.getAllForTenant(m, tenantA, false);
    expect(ownOnly.map((v) => v.name)).toEqual([TestSettingNames.Color]);

    await m.delete("T", tenantA);
    expect(await SettingManagerExtensions.getOrNullForTenant(m, TestSettingNames.Color, tenantA, false)).toBeUndefined();
    expect(await SettingManagerExtensions.getAllForTenant(m, tenantA, false)).toEqual([]);
  });
});

describe("SettingStore", () => {
  it("replaces NullSettingStore so ISettingProvider reads managed values for the current tenant and user", async () => {
    expect(test.getRequiredService(ISettingStore)).toBeInstanceOf(SettingStore);
    const m = manager();
    await SettingManagerExtensions.setGlobal(m, TestSettingNames.Color, "blue");
    await SettingManagerExtensions.setForTenant(m, tenantA, TestSettingNames.Color, "green");
    await currentTenant().run(tenantA, undefined, () => SettingManagerExtensions.setForUser(m, userId, TestSettingNames.Color, "yellow"));

    expect(await settingProvider().getOrNull(TestSettingNames.Color)).toBe("blue");
    await currentTenant().run(tenantA, undefined, async () => {
      expect(await settingProvider().getOrNull(TestSettingNames.Color)).toBe("green");
      await test.getRequiredService(ICurrentPrincipalAccessor).run(user, async () => {
        expect(await settingProvider().getOrNull(TestSettingNames.Color)).toBe("yellow");
        const all = await settingProvider().getAll([TestSettingNames.Color, TestSettingNames.GlobalOnly]);
        expect(all.map((v) => [v.name, v.value])).toEqual([
          [TestSettingNames.Color, "yellow"],
          [TestSettingNames.GlobalOnly, "global"],
        ]);
      });
    });
  });

  it("serves values from the distributed cache and invalidates them when the entity changes", async () => {
    const m = manager();
    await SettingManagerExtensions.setGlobal(m, TestSettingNames.Color, "cached");
    expect(await settingProvider().getOrNull(TestSettingNames.Color)).toBe("cached");
    const cacheStore = test.getRequiredService(IDistributedCacheStore) as MemoryDistributedCacheStore;
    expect(await cacheStore.get("c:Setting,k:pn:G,pk:,n:Test.Color")).toBeDefined();

    await test.withUnitOfWork(async (provider) => {
      const database = await provider.getRequired(memoryDatabaseProviderToken(SettingManagementMemoryDbContext)).getDatabase();
      const collection = database.collection(Setting);
      const entity = [...collection].find((s) => s.name === TestSettingNames.Color && s.providerName === "G")!;
      entity.value = "changed-behind-the-cache";
      collection.update(entity);
    });
    expect(await settingProvider().getOrNull(TestSettingNames.Color)).toBe("cached");

    const repository = test.getRequiredService(ISettingRepository);
    const entity = (await repository.find(TestSettingNames.Color, "G", undefined))!;
    entity.value = "changed-through-the-repository";
    await repository.update(entity, true);
    expect(await cacheStore.get("c:Setting,k:pn:G,pk:,n:Test.Color")).toBeUndefined();
    expect(await settingProvider().getOrNull(TestSettingNames.Color)).toBe("changed-through-the-repository");
    expect(await SettingManagerExtensions.getOrNullGlobal(m, TestSettingNames.Color)).toBe("changed-through-the-repository");
  });
});
