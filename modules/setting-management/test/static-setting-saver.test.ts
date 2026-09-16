import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, IStringLocalizerFactory } from "@abp/core";
import { AbpEmailingModule, EmailSettingNames } from "@abp/emailing";
import { AbpSettingOptions, IDynamicSettingDefinitionStore, ISettingDefinitionManager } from "@abp/settings";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpSettingManagementDomainModule, DynamicSettingDefinitionStore, IDynamicSettingDefinitionStoreInMemoryCache, ISettingDefinitionRecordRepository, IStaticSettingSaver, SettingManagementOptions } from "../src/domain/index.js";
import { AbpSettingManagementMemoryDbModule } from "../src/memory-db/index.js";
import { TestSettingNames, creationOptions } from "./test-support.js";
import "./test-support.js";

@DependsOn(AbpSettingManagementDomainModule, AbpSettingManagementMemoryDbModule, AbpEmailingModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(SettingManagementOptions, (options) => {
      options.isDynamicSettingStoreEnabled = true;
    });
  }
}

const test = createAbpIntegratedTest(TestModule, { setAbpApplicationCreationOptions: creationOptions });
beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const records = () => test.getRequiredService(ISettingDefinitionRecordRepository).getList();

describe("StaticSettingSaver", () => {
  it("saves the static setting definitions as records during application initialization", async () => {
    const all = await records();
    const host = all.find((r) => r.name === EmailSettingNames.Smtp.Host);
    expect(host).toMatchObject({ displayName: "L:AbpEmailing,DisplayName:Abp.Mailing.Smtp.Host", description: "L:AbpEmailing,Description:Abp.Mailing.Smtp.Host", defaultValue: "127.0.0.1", isVisibleToClients: false, isInherited: true, isEncrypted: false });
    expect(all.find((r) => r.name === EmailSettingNames.Smtp.Password)?.isEncrypted).toBe(true);
    expect(all.find((r) => r.name === TestSettingNames.GlobalOnly)?.providers).toBe("D,G");
    expect(all.find((r) => r.name === TestSettingNames.NotInherited)?.isInherited).toBe(false);
    expect(all.find((r) => r.name === TestSettingNames.Obsolete)?.extraProperties.get("Group")).toBe("Legacy");
    expect(await test.getRequiredService(ISettingDefinitionRecordRepository).findByName(TestSettingNames.Color)).toMatchObject({ defaultValue: "red", displayName: "F:Test.Color" });
  });

  it("is idempotent: unchanged definitions are neither duplicated nor rewritten", async () => {
    const before = await records();
    await test.getRequiredService(IStaticSettingSaver).save();
    const after = await records();
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it("removes the records of settings listed in AbpSettingOptions.deletedSettings", async () => {
    const settingOptions = test.rootServiceProvider.getOptions(AbpSettingOptions);
    settingOptions.deletedSettings.add(TestSettingNames.Obsolete);
    try {
      await test.getRequiredService(IStaticSettingSaver).save();
      expect((await records()).some((r) => r.name === TestSettingNames.Obsolete)).toBe(false);
    } finally {
      settingOptions.deletedSettings.delete(TestSettingNames.Obsolete);
    }
  });
});

describe("DynamicSettingDefinitionStore", () => {
  it("replaces the null store and serves the persisted definitions", async () => {
    const store = test.getRequiredService(IDynamicSettingDefinitionStore);
    expect(store).toBeInstanceOf(DynamicSettingDefinitionStore);

    const all = await store.getAll();
    expect(all.map((d) => d.name)).toEqual(expect.arrayContaining([EmailSettingNames.Smtp.Host, TestSettingNames.Color, TestSettingNames.GlobalOnly]));

    const smtpHost = await store.get(EmailSettingNames.Smtp.Host);
    expect(smtpHost.defaultValue).toBe("127.0.0.1");
    expect(smtpHost.displayName.localize(test.getRequiredService(IStringLocalizerFactory)).value).toBe("Host");
    expect((await store.getOrNull(TestSettingNames.GlobalOnly))?.providers).toEqual(["D", "G"]);
    expect((await store.getOrNull(TestSettingNames.NotInherited))?.isInherited).toBe(false);
    expect((await store.getOrNull(EmailSettingNames.Smtp.Password))?.isEncrypted).toBe(true);
    expect(await store.getOrNull("Nope")).toBeUndefined();
    await expect(store.get("Nope")).rejects.toThrow(/Undefined setting: Nope/);
  });

  it("refreshes its in-memory cache when the distributed stamp changes", async () => {
    const store = test.getRequiredService(IDynamicSettingDefinitionStore);
    const cache = test.getRequiredService(IDynamicSettingDefinitionStoreInMemoryCache);
    cache.lastCheckTime = undefined;
    expect((await store.getOrNull(TestSettingNames.Color))?.defaultValue).toBe("red");

    const repository = test.getRequiredService(ISettingDefinitionRecordRepository);
    const record = (await repository.findByName(TestSettingNames.Color))!;
    record.defaultValue = "purple";
    await repository.update(record, true);
    expect((await store.getOrNull(TestSettingNames.Color))?.defaultValue).toBe("red");

    cache.lastCheckTime = undefined;
    expect((await store.getOrNull(TestSettingNames.Color))?.defaultValue).toBe("red");

    cache.lastCheckTime = undefined;
    cache.cacheStamp = undefined;
    expect((await store.getOrNull(TestSettingNames.Color))?.defaultValue).toBe("purple");
  });

  it("is consulted by the definition manager after the static definitions", async () => {
    const manager = test.getRequiredService(ISettingDefinitionManager);
    expect((await manager.get(TestSettingNames.Color)).defaultValue).toBe("red");
    expect((await manager.getAll()).filter((d) => d.name === TestSettingNames.Color)).toHaveLength(1);
  });
});
