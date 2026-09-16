import { AbpApplication, AbpModule, DependsOn, Transient, hasErrorCode } from "@abp/core";
import { AbpAuthorizationModule, AbpPermissionOptions, IPermissionChecker, IPermissionStore, MultiplePermissionGrantResult, PermissionDefinitionProvider, PermissionGrantResult, type IPermissionDefinitionContext } from "@abp/authorization";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, AbpAuthorizationException, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor } from "@abp/security";
import { FreeTextStringValueType, ToggleStringValueType } from "@abp/validation";
import { describe, expect, it } from "vitest";
import {
  AbpFeatureErrorCodes,
  AbpFeatureOptions,
  AbpFeaturesModule,
  DisableFeatureCheck,
  EditionFeatureValueProvider,
  FeatureCheckerExtensions,
  FeatureDefinition,
  FeatureDefinitionProvider,
  IFeatureChecker,
  IFeatureDefinitionManager,
  IFeatureStore,
  IFeatureValueProviderManager,
  NullFeatureStore,
  RequiresFeature,
  RequiresFeatureMetadata,
  TenantFeatureValueProvider,
  requireFeatures,
  type IFeatureDefinitionContext,
} from "../src/index.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const editionId = "22222222-2222-4222-8222-222222222222";
const userId = "44444444-4444-4444-8444-444444444444";

class FakeFeatureStore implements IFeatureStore {
  readonly values = new Map<string, string>();
  set(name: string, providerName: string, providerKey: string | undefined, value: string): this {
    this.values.set(`${name}|${providerName}|${providerKey ?? ""}`, value);
    return this;
  }
  async getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined> {
    return this.values.get(`${name}|${providerName}|${providerKey ?? ""}`);
  }
}

class FakePermissionStore implements IPermissionStore {
  async isGranted(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<boolean> {
    return providerName === "U" && providerKey === userId && name.startsWith("Pdf");
  }
  async isGrantedMany(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<MultiplePermissionGrantResult> {
    const result = new MultiplePermissionGrantResult(names);
    for (const name of names) if (await this.isGranted(name, providerName, providerKey)) result.result.set(name, PermissionGrantResult.Granted);
    return result;
  }
}

@Transient()
class TestFeatureDefinitionProvider extends FeatureDefinitionProvider {
  define(context: IFeatureDefinitionContext): void {
    const group = context.addGroup("Reporting");
    const reporting = group.addFeature("Reporting", { defaultValue: "false" });
    reporting.createChild("Reporting.Pdf", { defaultValue: "false" });
    reporting.createChild("Reporting.Excel", { defaultValue: "true", valueType: new ToggleStringValueType() });
    group.addFeature("Reporting.MaxPages", { defaultValue: "10", valueType: new FreeTextStringValueType() });
    group.addFeature("Reporting.Broken", { defaultValue: "maybe" });
    group.addFeature("Reporting.TenantOnly", { defaultValue: "false" }).withProviders(TenantFeatureValueProvider.ProviderName);
    expect(context.getGroupOrNull("Reporting")).toBe(group);
    expect(() => context.addGroup("Reporting")).toThrow(/already an existing feature group/);
  }
}

@Transient()
class TestPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const group = context.addGroup("Pdf");
    requireFeatures(group.addPermission("Pdf.Export"), ["Reporting.Pdf"]);
    requireFeatures(group.addPermission("Pdf.Any"), ["Reporting.Pdf", "Reporting.Excel"], { requiresAll: false, batchCheck: false });
    requireFeatures(group.addPermission("Pdf.Both"), ["Reporting.Pdf", "Reporting.Excel"]);
  }
}

@Transient()
class ReportAppService {
  @RequiresFeature("Reporting.Pdf")
  async exportPdf(): Promise<string> {
    return "pdf";
  }

  @RequiresFeature("Reporting.Pdf", "Reporting.Excel")
  async exportAny(): Promise<string> {
    return "any";
  }

  @RequiresFeature("Reporting.Pdf", "Reporting.Excel", { requiresAll: true })
  async exportAll(): Promise<string> {
    return "all";
  }

  async plain(): Promise<string> {
    return "plain";
  }
}

@Transient()
@RequiresFeature("Reporting")
class ReportingAppService {
  async run(): Promise<string> {
    return "run";
  }

  @DisableFeatureCheck()
  async status(): Promise<string> {
    return "status";
  }
}

@DependsOn(AbpFeaturesModule, AbpAuthorizationModule)
class TestModule extends AbpModule {
  static readonly store = new FakeFeatureStore();
  override configureServices(): void {
    this.context.services.replaceSingleton(IFeatureStore, { useValue: TestModule.store });
    this.context.services.replaceSingleton(IPermissionStore, { useValue: new FakePermissionStore() });
  }
}

const user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId)], "Test"));
const editionUser = new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.editionId, editionId)], "Test"));

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { Features: { "Reporting.MaxPages": "20" } } } });
  await app.initialize();
  return app;
}

describe("feature definitions", () => {
  it("builds the feature tree from auto-registered providers", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getOptions(AbpFeatureOptions).definitionProviders.contains(TestFeatureDefinitionProvider)).toBe(true);
    const manager = app.serviceProvider.getRequired(IFeatureDefinitionManager);
    const reporting = await manager.get("Reporting");
    expect(reporting.children.map((c) => c.name)).toEqual(["Reporting.Pdf", "Reporting.Excel"]);
    expect((await manager.get("Reporting.Pdf")).parent).toBe(reporting);
    expect(reporting.valueType).toBeInstanceOf(ToggleStringValueType);
    expect((await manager.get("Reporting.MaxPages")).valueType).toBeInstanceOf(FreeTextStringValueType);
    expect((await manager.getAll()).map((f) => f.name)).toEqual(["Reporting", "Reporting.Pdf", "Reporting.Excel", "Reporting.MaxPages", "Reporting.Broken", "Reporting.TenantOnly"]);
    expect((await manager.getGroups())[0]!.getFeaturesWithChildren().map((f) => f.name).slice(0, 3)).toEqual(["Reporting", "Reporting.Pdf", "Reporting.Excel"]);
    await expect(manager.get("Nope")).rejects.toThrow("Undefined feature: Nope");
    expect(app.serviceProvider.getRequired(IFeatureValueProviderManager).valueProviders.map((p) => p.name)).toEqual(["D", "C", "E", "T"]);

    const definition = new FeatureDefinition("X");
    const child = definition.createChild("X.Y");
    expect(child.parent).toBe(definition);
    definition.removeChild("X.Y");
    expect(child.parent).toBeUndefined();
    expect(() => definition.removeChild("X.Y")).toThrow(/Could not find a feature named/);
    await app.shutdown();
  });
});

describe("FeatureChecker", () => {
  it("resolves tenant > edition > configuration > default and gives the host the default", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IFeatureChecker);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const store = TestModule.store;

    expect(await checker.isEnabled("Reporting.Pdf")).toBe(false);
    expect(await checker.isEnabled("Reporting.Excel")).toBe(true);
    expect(await checker.getOrNull("Reporting.MaxPages")).toBe("20");
    expect(await checker.getOrNull("Unknown")).toBeUndefined();
    expect(await checker.isEnabled("Unknown")).toBe(false);
    await expect(checker.isEnabled("Reporting.Broken")).rejects.toThrow(/should be a boolean/);

    store.set("Reporting.Pdf", TenantFeatureValueProvider.ProviderName, tenantId, "true");
    expect(await currentTenant.run(tenantId, undefined, () => checker.isEnabled("Reporting.Pdf"))).toBe(true);
    expect(await checker.isEnabled("Reporting.Pdf")).toBe(false);

    store.set("Reporting.MaxPages", EditionFeatureValueProvider.ProviderName, editionId, "50");
    expect(await accessor.run(editionUser, () => checker.getOrNull("Reporting.MaxPages"))).toBe("50");
    expect(await accessor.run(user, () => checker.getOrNull("Reporting.MaxPages"))).toBe("20");
    store.set("Reporting.MaxPages", TenantFeatureValueProvider.ProviderName, tenantId, "99");
    expect(await currentTenant.run(tenantId, undefined, () => accessor.run(editionUser, () => checker.getOrNull("Reporting.MaxPages")))).toBe("99");

    store.set("Reporting.TenantOnly", EditionFeatureValueProvider.ProviderName, editionId, "true");
    expect(await accessor.run(editionUser, () => checker.isEnabled("Reporting.TenantOnly"))).toBe(false);
    store.set("Reporting.TenantOnly", TenantFeatureValueProvider.ProviderName, tenantId, "true");
    expect(await currentTenant.run(tenantId, undefined, () => checker.isEnabled("Reporting.TenantOnly"))).toBe(true);

    const many = await currentTenant.run(tenantId, undefined, () => checker.isEnabledMany(["Reporting.Pdf", "Reporting.Excel", "Reporting"]));
    expect([...many]).toEqual([
      ["Reporting.Pdf", true],
      ["Reporting.Excel", true],
      ["Reporting", false],
    ]);
    await app.shutdown();
  });

  it("offers typed helpers and throwing checks", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IFeatureChecker);
    expect(await FeatureCheckerExtensions.getAsNumber(checker, "Reporting.MaxPages")).toBe(20);
    expect(await FeatureCheckerExtensions.getAsNumber(checker, "Unknown", 5)).toBe(5);
    expect(await FeatureCheckerExtensions.getAsBoolean(checker, "Reporting.Excel")).toBe(true);
    expect(await FeatureCheckerExtensions.isEnabled(checker, false, ["Reporting.Pdf", "Reporting.Excel"])).toBe(true);
    expect(await FeatureCheckerExtensions.isEnabled(checker, true, ["Reporting.Pdf", "Reporting.Excel"])).toBe(false);
    expect(await FeatureCheckerExtensions.isEnabled(checker, true, [])).toBe(true);
    await FeatureCheckerExtensions.checkEnabled(checker, "Reporting.Excel");
    const error = await FeatureCheckerExtensions.checkEnabled(checker, "Reporting.Pdf").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbpAuthorizationException);
    expect(hasErrorCode(error) && error.code).toBe(AbpFeatureErrorCodes.FeatureIsNotEnabled);
    expect((error as AbpAuthorizationException).message).toBe("Feature is not enabled: Reporting.Pdf");
    const all = await FeatureCheckerExtensions.checkEnabledMany(checker, true, ["Reporting.Pdf", "Reporting.Excel"]).catch((e: unknown) => e);
    expect(hasErrorCode(all) && all.code).toBe(AbpFeatureErrorCodes.AllOfTheseFeaturesMustBeEnabled);
    expect((all as AbpAuthorizationException).data).toEqual({ FeatureNames: "Reporting.Pdf, Reporting.Excel" });
    const any = await FeatureCheckerExtensions.checkEnabledMany(checker, false, ["Reporting.Pdf", "Reporting"]).catch((e: unknown) => e);
    expect(hasErrorCode(any) && any.code).toBe(AbpFeatureErrorCodes.AtLeastOneOfTheseFeaturesMustBeEnabled);
    await app.shutdown();
  });
});

describe("FeatureInterceptor", () => {
  it("allows or denies intercepted methods by RequiresFeature metadata", async () => {
    const app = await createApp();
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    const service = app.serviceProvider.getRequired(ReportAppService);
    expect(RequiresFeatureMetadata.hasAny(ReportAppService)).toBe(true);
    expect(RequiresFeatureMetadata.hasAny(FakeFeatureStore)).toBe(false);

    await expect(service.exportPdf()).rejects.toBeInstanceOf(AbpAuthorizationException);
    expect(await service.exportAny()).toBe("any");
    await expect(service.exportAll()).rejects.toBeInstanceOf(AbpAuthorizationException);
    expect(await service.plain()).toBe("plain");

    TestModule.store.set("Reporting.Pdf", TenantFeatureValueProvider.ProviderName, tenantId, "true");
    expect(await currentTenant.run(tenantId, undefined, () => service.exportPdf())).toBe("pdf");
    expect(await currentTenant.run(tenantId, undefined, () => service.exportAll())).toBe("all");
    await expect(service.exportPdf()).rejects.toBeInstanceOf(AbpAuthorizationException);

    const reporting = app.serviceProvider.getRequired(ReportingAppService);
    await expect(reporting.run()).rejects.toBeInstanceOf(AbpAuthorizationException);
    expect(await reporting.status()).toBe("status");
    TestModule.store.set("Reporting", TenantFeatureValueProvider.ProviderName, tenantId, "true");
    expect(await currentTenant.run(tenantId, undefined, () => reporting.run())).toBe("run");
    await app.shutdown();
  });
});

describe("requireFeatures on permission definitions", () => {
  it("gates permissions through the authorization simple state checker manager", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getOptions(AbpPermissionOptions).definitionProviders.contains(TestPermissionDefinitionProvider)).toBe(true);
    const permissionChecker = app.serviceProvider.getRequired(IPermissionChecker);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);

    expect(await accessor.run(user, () => permissionChecker.isGranted("Pdf.Export"))).toBe(false);
    expect(await accessor.run(user, () => permissionChecker.isGranted("Pdf.Any"))).toBe(true);
    expect(await accessor.run(user, () => permissionChecker.isGranted("Pdf.Both"))).toBe(false);
    const before = await accessor.run(user, () => permissionChecker.isGranted(["Pdf.Export", "Pdf.Any", "Pdf.Both"]));
    expect([...before.result.values()]).toEqual([PermissionGrantResult.Undefined, PermissionGrantResult.Granted, PermissionGrantResult.Undefined]);

    TestModule.store.set("Reporting.Pdf", TenantFeatureValueProvider.ProviderName, tenantId, "true");
    const inTenant = <T>(fn: () => Promise<T>) => currentTenant.run(tenantId, undefined, () => accessor.run(user, fn));
    expect(await inTenant(() => permissionChecker.isGranted("Pdf.Export"))).toBe(true);
    expect(await inTenant(() => permissionChecker.isGranted("Pdf.Both"))).toBe(true);
    const after = await inTenant(() => permissionChecker.isGranted(["Pdf.Export", "Pdf.Any", "Pdf.Both"]));
    expect(after.allGranted).toBe(true);
    await app.shutdown();
  });
});

describe("NullFeatureStore", () => {
  it("knows nothing", async () => {
    expect(await new NullFeatureStore().getOrNull()).toBeUndefined();
  });
});
