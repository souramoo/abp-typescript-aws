import { AbpApplication, AbpModule, DependsOn, Transient } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor, IStringEncryptionService } from "@abp/security";
import { describe, expect, it } from "vitest";
import {
  AbpSettingOptions,
  AbpSettingsModule,
  ConfigurationSettingValueProvider,
  DefaultValueSettingValueProvider,
  GlobalSettingValueProvider,
  ISettingDefinitionManager,
  ISettingEncryptionService,
  ISettingProvider,
  ISettingStore,
  ISettingValueProviderManager,
  NullSettingStore,
  SettingDefinition,
  SettingDefinitionProvider,
  SettingProviderExtensions,
  SettingValue,
  TenantSettingValueProvider,
  UserSettingValueProvider,
  type ISettingDefinitionContext,
} from "../src/index.js";

const userId = "44444444-4444-4444-8444-444444444444";
const tenantId = "11111111-1111-4111-8111-111111111111";

class FakeSettingStore implements ISettingStore {
  readonly values = new Map<string, string>();
  set(name: string, providerName: string, providerKey: string | undefined, value: string): this {
    this.values.set(`${name}|${providerName}|${providerKey ?? ""}`, value);
    return this;
  }
  async getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined> {
    return this.values.get(`${name}|${providerName}|${providerKey ?? ""}`);
  }
  async getAll(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]> {
    const result: SettingValue[] = [];
    for (const name of names) result.push(new SettingValue(name, await this.getOrNull(name, providerName, providerKey)));
    return result;
  }
}

@Transient()
class TestSettingDefinitionProvider extends SettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void {
    context.add(
      new SettingDefinition("Test.Layered", "default"),
      new SettingDefinition("Test.NotInherited", "default", undefined, undefined, false, false),
      new SettingDefinition("Test.GlobalOnly", "default").withProviders(GlobalSettingValueProvider.ProviderName),
      new SettingDefinition("Test.Secret", undefined, undefined, undefined, false, true, true),
      new SettingDefinition("Test.Flag", "true"),
      new SettingDefinition("Test.Number", "42"),
      new SettingDefinition("Test.Empty"),
    );
    expect(context.getOrNull("Test.Flag")?.defaultValue).toBe("true");
    expect(context.getAll().length).toBeGreaterThanOrEqual(7);
  }
}

@DependsOn(AbpSettingsModule)
class TestModule extends AbpModule {
  static readonly store = new FakeSettingStore();
  override configureServices(): void {
    this.context.services.replaceSingleton(ISettingStore, { useValue: TestModule.store });
  }
}

const user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId)], "Test"));

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { Settings: { "Test.Layered": "configuration", "Test.Number": "7" } } } });
  await app.initialize();
  return app;
}

describe("setting definitions", () => {
  it("collects definitions from auto-registered providers", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getOptions(AbpSettingOptions).definitionProviders.contains(TestSettingDefinitionProvider)).toBe(true);
    const manager = app.serviceProvider.getRequired(ISettingDefinitionManager);
    expect((await manager.get("Test.Layered")).defaultValue).toBe("default");
    expect((await manager.get("Test.NotInherited")).isInherited).toBe(false);
    expect((await manager.get("Test.Secret")).isEncrypted).toBe(true);
    expect((await manager.get("Test.GlobalOnly")).providers).toEqual(["G"]);
    expect(await manager.getOrNull("Nope")).toBeUndefined();
    await expect(manager.get("Nope")).rejects.toThrow("Undefined setting: Nope");
    expect((await manager.getAll()).map((s) => s.name)).toContain("Test.Flag");
    expect(app.serviceProvider.getRequired(ISettingValueProviderManager).providers.map((p) => p.name)).toEqual(["D", "C", "G", "T", "U"]);
    await app.shutdown();
  });
});

describe("SettingProvider", () => {
  it("resolves values by provider precedence: user > tenant > global > configuration > default", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ISettingProvider);
    const store = TestModule.store;
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const asTenantUser = <T>(fn: () => Promise<T>) => currentTenant.run(tenantId, undefined, () => accessor.run(user, fn));

    expect(await provider.getOrNull("Test.Empty")).toBeUndefined();
    expect(await provider.getOrNull("Undefined.Setting")).toBeUndefined();
    expect(await provider.getOrNull("Test.Number")).toBe("7");
    expect(await provider.getOrNull("Test.Layered")).toBe("configuration");
    store.set("Test.Layered", GlobalSettingValueProvider.ProviderName, undefined, "global");
    expect(await provider.getOrNull("Test.Layered")).toBe("global");
    store.set("Test.Layered", TenantSettingValueProvider.ProviderName, tenantId, "tenant");
    expect(await provider.getOrNull("Test.Layered")).toBe("global");
    expect(await currentTenant.run(tenantId, undefined, () => provider.getOrNull("Test.Layered"))).toBe("tenant");
    store.set("Test.Layered", UserSettingValueProvider.ProviderName, userId, "user");
    expect(await asTenantUser(() => provider.getOrNull("Test.Layered"))).toBe("user");
    expect(await accessor.run(user, () => provider.getOrNull("Test.Layered"))).toBe("user");

    const all = await asTenantUser(() => provider.getAll(["Test.Layered", "Test.Number", "Test.Empty", "Unknown"]));
    expect(all.map((v) => [v.name, v.value])).toEqual([
      ["Test.Layered", "user"],
      ["Test.Number", "7"],
      ["Test.Empty", undefined],
    ]);
    const everything = await provider.getAll();
    expect(everything.find((v) => v.name === "Test.Flag")?.value).toBe("true");
    expect(everything.length).toBeGreaterThanOrEqual(7);
    await app.shutdown();
  });

  it("does not fall back to parent scopes for a non-inherited setting", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ISettingProvider);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    TestModule.store.set("Test.NotInherited", GlobalSettingValueProvider.ProviderName, undefined, "global");

    expect(await provider.getOrNull("Test.NotInherited")).toBe("default");
    expect(await accessor.run(user, () => provider.getOrNull("Test.NotInherited"))).toBe("default");
    expect((await accessor.run(user, () => provider.getAll(["Test.NotInherited"])))[0]?.value).toBe("default");

    TestModule.store.set("Test.NotInherited", UserSettingValueProvider.ProviderName, userId, "user");
    expect(await accessor.run(user, () => provider.getOrNull("Test.NotInherited"))).toBe("user");
    expect((await accessor.run(user, () => provider.getAll(["Test.NotInherited"])))[0]?.value).toBe("user");
    await app.shutdown();
  });

  it("restricts a setting to its allowed providers", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ISettingProvider);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    TestModule.store.set("Test.GlobalOnly", UserSettingValueProvider.ProviderName, userId, "user");
    expect(await accessor.run(user, () => provider.getOrNull("Test.GlobalOnly"))).toBeUndefined();
    TestModule.store.set("Test.GlobalOnly", GlobalSettingValueProvider.ProviderName, undefined, "global");
    expect(await accessor.run(user, () => provider.getOrNull("Test.GlobalOnly"))).toBe("global");
    expect((await accessor.run(user, () => provider.getAll(["Test.GlobalOnly"])))[0]?.value).toBe("global");
    await app.shutdown();
  });

  it("decrypts encrypted settings and keeps unreadable values when configured", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ISettingProvider);
    const encryption = app.serviceProvider.getRequired(ISettingEncryptionService);
    const definition = await app.serviceProvider.getRequired(ISettingDefinitionManager).get("Test.Secret");
    const encrypted = encryption.encrypt(definition, "s3cret")!;
    expect(encrypted).not.toBe("s3cret");
    expect(app.serviceProvider.getRequired(IStringEncryptionService).decrypt(encrypted)).toBe("s3cret");

    TestModule.store.set("Test.Secret", GlobalSettingValueProvider.ProviderName, undefined, encrypted);
    expect(await provider.getOrNull("Test.Secret")).toBe("s3cret");
    expect((await provider.getAll(["Test.Secret"]))[0]?.value).toBe("s3cret");

    TestModule.store.set("Test.Secret", GlobalSettingValueProvider.ProviderName, undefined, "not-encrypted");
    expect(await provider.getOrNull("Test.Secret")).toBe("not-encrypted");
    app.serviceProvider.getOptions(AbpSettingOptions).returnOriginalValueIfDecryptFailed = false;
    expect(await provider.getOrNull("Test.Secret")).toBe("");
    expect(encryption.encrypt(definition, "")).toBe("");
    expect(encryption.decrypt(definition, undefined)).toBeUndefined();
    await app.shutdown();
  });

  it("offers typed helpers", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ISettingProvider);
    expect(await SettingProviderExtensions.isTrue(provider, "Test.Flag")).toBe(true);
    expect(await SettingProviderExtensions.isTrue(provider, "Test.Empty")).toBe(false);
    expect(await SettingProviderExtensions.getAsBoolean(provider, "Test.Flag")).toBe(true);
    expect(await SettingProviderExtensions.getAsBoolean(provider, "Test.Empty", true)).toBe(true);
    expect(await SettingProviderExtensions.getAsNumber(provider, "Test.Number")).toBe(7);
    expect(await SettingProviderExtensions.getAsNumber(provider, "Test.Empty", 3)).toBe(3);
    await expect(SettingProviderExtensions.getAsNumber(provider, "Test.Flag")).rejects.toThrow(/not a valid number/);
    expect(await SettingProviderExtensions.get(provider, "Test.Number", [], (v) => v.split(""))).toEqual(["7"]);
    await app.shutdown();
  });
});

describe("value providers without a store", () => {
  it("NullSettingStore and the default/configuration providers return what they know", async () => {
    const store = new NullSettingStore();
    expect(await store.getOrNull()).toBeUndefined();
    expect(await store.getAll(["a"])).toEqual([new SettingValue("a", undefined)]);
    const definition = new SettingDefinition("X", "x");
    expect(await new DefaultValueSettingValueProvider(store).getOrNull(definition)).toBe("x");
    expect(await new DefaultValueSettingValueProvider(store).getAll([definition])).toEqual([new SettingValue("X", "x")]);
    expect(ConfigurationSettingValueProvider.ConfigurationNamePrefix).toBe("Settings:");
  });
});
