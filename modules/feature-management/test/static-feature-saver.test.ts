import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, IStringLocalizerFactory } from "@abp/core";
import { AbpFeatureOptions, IDynamicFeatureDefinitionStore, IFeatureDefinitionManager } from "@abp/features";
import { createAbpIntegratedTest } from "@abp/test-base";
import { NumericValueValidator } from "@abp/validation";
import { AbpFeatureManagementDomainModule, DynamicFeatureDefinitionStore, FeatureManagementOptions, IDynamicFeatureDefinitionStoreInMemoryCache, IFeatureDefinitionRecordRepository, IFeatureGroupDefinitionRecordRepository, IStaticFeatureSaver, StringValueTypeSerializer } from "../src/domain/index.js";
import { AbpFeatureManagementMemoryDbModule } from "../src/memory-db/index.js";
import { TestFeatures, creationOptions } from "./test-support.js";
import "./test-support.js";

@DependsOn(AbpFeatureManagementDomainModule, AbpFeatureManagementMemoryDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(FeatureManagementOptions, (options) => {
      options.isDynamicFeatureStoreEnabled = true;
    });
  }
}

const test = createAbpIntegratedTest(TestModule, { setAbpApplicationCreationOptions: creationOptions });
beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const features = () => test.getRequiredService(IFeatureDefinitionRecordRepository).getList();
const groups = () => test.getRequiredService(IFeatureGroupDefinitionRecordRepository).getList();

describe("StaticFeatureSaver", () => {
  it("saves the static groups and features as records during application initialization", async () => {
    expect((await groups()).map((g) => g.name).sort()).toEqual(["Legacy", TestFeatures.GroupName]);
    const all = await features();
    const boolean = all.find((r) => r.name === TestFeatures.Boolean)!;
    expect(boolean).toMatchObject({ groupName: TestFeatures.GroupName, parentName: undefined, displayName: "L:AbpFeatureManagement,ManageHostFeatures", defaultValue: "false", isVisibleToClients: true, isAvailableToHost: true });
    expect(JSON.parse(boolean.valueType)).toEqual({ name: "ToggleStringValueType", properties: {}, validator: { name: "BOOLEAN", properties: {} } });
    expect(all.find((r) => r.name === TestFeatures.BooleanChild)?.parentName).toBe(TestFeatures.Boolean);
    expect(all.find((r) => r.name === TestFeatures.Number)?.extraProperties.get("Unit")).toBe("items");
    expect(all.find((r) => r.name === TestFeatures.EditionOnly)?.allowedProviders).toBe("D,E");
    expect(all.find((r) => r.name === TestFeatures.TenantOnly)?.isAvailableToHost).toBe(false);
    expect(await test.getRequiredService(IFeatureDefinitionRecordRepository).findByName(TestFeatures.Number)).toMatchObject({ defaultValue: "10" });
  });

  it("is idempotent: unchanged definitions are neither duplicated nor rewritten", async () => {
    const before = await features();
    await test.getRequiredService(IStaticFeatureSaver).save();
    const after = await features();
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it("removes the records of deleted groups and features", async () => {
    const featureOptions = test.rootServiceProvider.getOptions(AbpFeatureOptions);
    featureOptions.deletedFeatureGroups.add("Legacy");
    try {
      await test.getRequiredService(IStaticFeatureSaver).save();
      expect((await groups()).some((g) => g.name === "Legacy")).toBe(false);
      expect((await features()).some((r) => r.name === TestFeatures.Obsolete)).toBe(false);
    } finally {
      featureOptions.deletedFeatureGroups.delete("Legacy");
    }
  });
});

describe("StringValueTypeSerializer", () => {
  it("round-trips value types with their validators in the .NET JSON shape", () => {
    const serializer = test.getRequiredService(StringValueTypeSerializer);
    const json = '{"itemSource":{"items":[{"value":"TestValue","displayText":{"resourceName":"TestResourceName","name":"TestName"}}]},"name":"SelectionStringValueType","properties":{},"validator":{"name":"NULL","properties":{}}}';
    const valueType = serializer.deserialize(json);
    expect(valueType.name).toBe("SELECTION");
    expect(serializer.serialize(valueType)).toBe(json);

    const numeric = serializer.deserialize(JSON.stringify({ name: "FreeTextStringValueType", properties: {}, validator: { name: "NUMERIC", properties: { MinValue: 1, MaxValue: 5 } } }));
    expect(numeric.validator).toBeInstanceOf(NumericValueValidator);
    expect(numeric.validator.isValid("3")).toBe(true);
    expect(numeric.validator.isValid("9")).toBe(false);
    expect(() => serializer.deserialize('{"name":"Nope"}')).toThrow(/was not found/);
  });
});

describe("DynamicFeatureDefinitionStore", () => {
  it("replaces the null store and rebuilds groups, features and children from the records", async () => {
    const store = test.getRequiredService(IDynamicFeatureDefinitionStore);
    expect(store).toBeInstanceOf(DynamicFeatureDefinitionStore);

    const group = (await store.getGroups()).find((g) => g.name === TestFeatures.GroupName)!;
    expect(group.displayName.localize(test.getRequiredService(IStringLocalizerFactory)).value).toBe("Features");
    expect(group.features.map((f) => f.name)).toEqual([TestFeatures.Boolean, TestFeatures.Number, TestFeatures.TenantOnly, TestFeatures.EditionOnly]);

    const boolean = (await store.getOrNull(TestFeatures.Boolean))!;
    expect(boolean.children.map((c) => c.name)).toEqual([TestFeatures.BooleanChild]);
    expect(boolean.valueType.name).toBe("TOGGLE");
    expect((await store.getOrNull(TestFeatures.BooleanChild))?.parent?.name).toBe(TestFeatures.Boolean);
    expect((await store.getOrNull(TestFeatures.Number))?.valueType.validator.isValid("101")).toBe(false);
    expect((await store.getOrNull(TestFeatures.EditionOnly))?.allowedProviders).toEqual(["D", "E"]);
    expect(await store.getOrNull("Nope")).toBeUndefined();
    expect((await store.getFeatures()).map((f) => f.name)).toContain(TestFeatures.BooleanChild);
  });

  it("refreshes its in-memory cache when the distributed stamp changes", async () => {
    const store = test.getRequiredService(IDynamicFeatureDefinitionStore);
    const cache = test.getRequiredService(IDynamicFeatureDefinitionStoreInMemoryCache);
    cache.lastCheckTime = undefined;
    expect((await store.getOrNull(TestFeatures.Number))?.defaultValue).toBe("10");

    const repository = test.getRequiredService(IFeatureDefinitionRecordRepository);
    const record = (await repository.findByName(TestFeatures.Number))!;
    record.defaultValue = "20";
    await repository.update(record, true);
    expect((await store.getOrNull(TestFeatures.Number))?.defaultValue).toBe("10");

    cache.lastCheckTime = undefined;
    expect((await store.getOrNull(TestFeatures.Number))?.defaultValue).toBe("10");

    cache.lastCheckTime = undefined;
    cache.cacheStamp = undefined;
    expect((await store.getOrNull(TestFeatures.Number))?.defaultValue).toBe("20");
  });

  it("is consulted by the definition manager after the static definitions", async () => {
    const manager = test.getRequiredService(IFeatureDefinitionManager);
    expect((await manager.get(TestFeatures.Number)).defaultValue).toBe("10");
    expect((await manager.getGroups()).filter((g) => g.name === TestFeatures.GroupName)).toHaveLength(1);
  });
});
