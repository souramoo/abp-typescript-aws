import { AbpModule, DependsOn, LocalizableString, NullLoggerFactory, Transient, type AbpApplicationCreationOptions, type ServiceConfigurationContext } from "@abp/core";
import { IPermissionStore, MultiplePermissionGrantResult, PermissionDefinitionProvider, PermissionGrantResult, type IPermissionDefinitionContext } from "@abp/authorization";
import { AbpAspNetCoreMultiTenancyModule, AbpAuthenticationOptions, AbpHttpHost, AuthenticateResult, type AbpHttpContext, type AbpHttpResponse, type IAuthenticationHandler } from "@abp/aws-lambda";
import { FeatureDefinitionProvider, type IFeatureDefinitionContext } from "@abp/features";
import { AbpMultiTenancyOptions } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal } from "@abp/security";
import { createAbpIntegratedTest, type AbpIntegratedTest } from "@abp/test-base";
import { FreeTextStringValueType, NumericValueValidator, ToggleStringValueType } from "@abp/validation";
import { AbpFeatureManagementApplicationModule } from "../src/application/index.js";
import { FeatureManagementPermissions } from "../src/application-contracts/index.js";
import { AbpFeatureManagementResource } from "../src/domain-shared/index.js";
import { AbpFeatureManagementHttpApiModule } from "../src/http-api/index.js";
import { AbpFeatureManagementMemoryDbModule } from "../src/memory-db/index.js";

export const userId = "44444444-4444-4444-8444-444444444444";
export const tenantA = "11111111-1111-4111-8111-111111111111";
export const tenantB = "22222222-2222-4222-8222-222222222222";
export const editionA = "33333333-3333-4333-8333-333333333333";
export const ManageTenantFeatures = "AbpTenantManagement.Tenants.ManageFeatures";

export const TestFeatures = {
  GroupName: "Test",
  Boolean: "Test.Boolean",
  BooleanChild: "Test.Boolean.Child",
  Number: "Test.Number",
  TenantOnly: "Test.TenantOnly",
  EditionOnly: "Test.EditionOnly",
  Obsolete: "Test.Obsolete",
} as const;

function L(name: string): LocalizableString {
  return LocalizableString.create(AbpFeatureManagementResource, name);
}

@Transient()
export class TestFeatureDefinitionProvider extends FeatureDefinitionProvider {
  define(context: IFeatureDefinitionContext): void {
    const group = context.addGroup(TestFeatures.GroupName, L("Features"));
    const boolean = group.addFeature(TestFeatures.Boolean, { defaultValue: "false", displayName: L("ManageHostFeatures"), valueType: new ToggleStringValueType() });
    boolean.createChild(TestFeatures.BooleanChild, { defaultValue: "false", valueType: new ToggleStringValueType() });
    group.addFeature(TestFeatures.Number, { defaultValue: "10", valueType: new FreeTextStringValueType(new NumericValueValidator(0, 100)) }).withProperty("Unit", "items");
    group.addFeature(TestFeatures.TenantOnly, { defaultValue: "false", isAvailableToHost: false });
    group.addFeature(TestFeatures.EditionOnly, { defaultValue: "edition", valueType: new FreeTextStringValueType() }).withProviders("D", "E");
    context.addGroup("Legacy").addFeature(TestFeatures.Obsolete, { defaultValue: "old" });
  }
}

/** The tenant management permission referenced by `FeatureManagementOptions.providerPolicies["T"]` (that module is not a dependency here). */
@Transient()
export class TestPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    context.addGroup("AbpTenantManagement").addPermission(ManageTenantFeatures);
  }
}

export class FakePermissionStore implements IPermissionStore {
  readonly grants = new Set<string>();
  grant(name: string, providerName: string, providerKey: string): this {
    this.grants.add(`${name}|${providerName}|${providerKey}`);
    return this;
  }
  async isGranted(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<boolean> {
    return this.grants.has(`${name}|${providerName}|${providerKey}`);
  }
  async isGrantedMany(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<MultiplePermissionGrantResult> {
    const result = new MultiplePermissionGrantResult(names);
    for (const name of names) if (await this.isGranted(name, providerName, providerKey)) result.result.set(name, PermissionGrantResult.Granted);
    return result;
  }
}

/** Authenticates `x-test-user` as `userId`; `x-test-tenant: acme` adds the tenant claim. */
@Transient()
export class HeaderAuthenticationHandler implements IAuthenticationHandler {
  async authenticate(context: AbpHttpContext): Promise<AuthenticateResult> {
    const user = context.request.headers.get("x-test-user");
    if (!user) return AuthenticateResult.noResult();
    const claims = [new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.userName, user)];
    if (context.request.headers.get("x-test-tenant") === "acme") claims.push(new Claim(AbpClaimTypes.tenantId, tenantA));
    return AuthenticateResult.success(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")));
  }

  async challenge(context: AbpHttpContext): Promise<void> {
    context.response.headers.set("www-authenticate", "Test");
  }
}

export const permissionStore = new FakePermissionStore().grant(FeatureManagementPermissions.ManageHostFeatures, "U", userId).grant(ManageTenantFeatures, "U", userId);

@DependsOn(AbpFeatureManagementApplicationModule, AbpFeatureManagementHttpApiModule, AbpFeatureManagementMemoryDbModule, AbpAspNetCoreMultiTenancyModule)
export class FeatureManagementHttpTestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.replaceSingleton(IPermissionStore, { useValue: permissionStore });
    this.configure(AbpAuthenticationOptions, (options) => options.addScheme("Test", HeaderAuthenticationHandler));
    this.configure(AbpMultiTenancyOptions, (options) => {
      options.isEnabled = true;
    });
  }
}

export function creationOptions(options: AbpApplicationCreationOptions): void {
  options.applicationName = "FeatureManagementTests";
  options.loggerFactory = NullLoggerFactory.instance;
  options.configuration = { skipDefaults: true, values: { Tenants: [{ Id: tenantA, Name: "acme", EditionId: editionA }, { Id: tenantB, Name: "other" }] } };
}

export function createHttpTest(): AbpIntegratedTest<typeof FeatureManagementHttpTestModule> {
  return createAbpIntegratedTest(FeatureManagementHttpTestModule, { setAbpApplicationCreationOptions: creationOptions });
}

export function json<T = Record<string, unknown>>(response: AbpHttpResponse): T {
  return JSON.parse(response.bodyText) as T;
}

export function host(test: AbpIntegratedTest): AbpHttpHost {
  return new AbpHttpHost(test.application);
}

export const AuthenticatedHeaders = { "x-test-user": "john" };
export const TenantHeaders = { "x-test-user": "john", "x-test-tenant": "acme" };
