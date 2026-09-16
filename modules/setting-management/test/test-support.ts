import { AbpModule, DependsOn, NullLoggerFactory, Transient, type AbpApplicationCreationOptions, type ServiceConfigurationContext } from "@abp/core";
import { IPermissionStore, MultiplePermissionGrantResult, PermissionGrantResult } from "@abp/authorization";
import { AbpAspNetCoreMultiTenancyModule, AbpAuthenticationOptions, AbpHttpHost, AuthenticateResult, type AbpHttpContext, type AbpHttpResponse, type IAuthenticationHandler } from "@abp/aws-lambda";
import { IEmailSender, type EmailSendArgs, type MailMessage } from "@abp/emailing";
import { AbpMultiTenancyOptions } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal } from "@abp/security";
import { SettingDefinition, SettingDefinitionProvider, type ISettingDefinitionContext } from "@abp/settings";
import { createAbpIntegratedTest, type AbpIntegratedTest } from "@abp/test-base";
import { AbpSettingManagementApplicationModule } from "../src/application/index.js";
import { SettingManagementPermissions } from "../src/application-contracts/index.js";
import { AbpSettingManagementHttpApiModule } from "../src/http-api/index.js";
import { AbpSettingManagementMemoryDbModule } from "../src/memory-db/index.js";

export const userId = "44444444-4444-4444-8444-444444444444";
export const tenantA = "11111111-1111-4111-8111-111111111111";
export const tenantB = "22222222-2222-4222-8222-222222222222";

export const TestSettingNames = {
  Color: "Test.Color",
  Secret: "Test.Secret",
  GlobalOnly: "Test.GlobalOnly",
  NotInherited: "Test.NotInherited",
  Obsolete: "Test.Obsolete",
} as const;

@Transient()
export class TestSettingDefinitionProvider extends SettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void {
    context.add(
      new SettingDefinition(TestSettingNames.Color, "red"),
      new SettingDefinition(TestSettingNames.Secret, undefined, undefined, undefined, false, true, true),
      new SettingDefinition(TestSettingNames.GlobalOnly, "global").withProviders("D", "G"),
      new SettingDefinition(TestSettingNames.NotInherited, "own", undefined, undefined, false, false),
      new SettingDefinition(TestSettingNames.Obsolete, "old").withProperty("Group", "Legacy"),
    );
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

export class FakeEmailSender implements IEmailSender {
  readonly sent: EmailSendArgs[] = [];
  async send(args: EmailSendArgs): Promise<void> {
    if (args.to === "fail@example.com") throw new Error("smtp down");
    this.sent.push(args);
  }
  async sendMail(_mail: MailMessage): Promise<void> {}
  async queue(args: EmailSendArgs): Promise<void> {
    await this.send(args);
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

export const permissionStore = new FakePermissionStore()
  .grant(SettingManagementPermissions.Emailing, "U", userId)
  .grant(SettingManagementPermissions.EmailingTest, "U", userId)
  .grant(SettingManagementPermissions.TimeZone, "U", userId);
export const emailSender = new FakeEmailSender();

@DependsOn(AbpSettingManagementApplicationModule, AbpSettingManagementHttpApiModule, AbpSettingManagementMemoryDbModule, AbpAspNetCoreMultiTenancyModule)
export class SettingManagementHttpTestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.replaceSingleton(IPermissionStore, { useValue: permissionStore });
    context.services.replaceSingleton(IEmailSender, { useValue: emailSender });
    this.configure(AbpAuthenticationOptions, (options) => options.addScheme("Test", HeaderAuthenticationHandler));
    this.configure(AbpMultiTenancyOptions, (options) => {
      options.isEnabled = true;
    });
  }
}

export function creationOptions(options: AbpApplicationCreationOptions): void {
  options.applicationName = "SettingManagementTests";
  options.loggerFactory = NullLoggerFactory.instance;
  options.configuration = { skipDefaults: true, values: { Tenants: [{ Id: tenantA, Name: "acme" }] } };
}

export function createHttpTest(): AbpIntegratedTest<typeof SettingManagementHttpTestModule> {
  return createAbpIntegratedTest(SettingManagementHttpTestModule, { setAbpApplicationCreationOptions: creationOptions });
}

export function json<T = Record<string, unknown>>(response: AbpHttpResponse): T {
  return JSON.parse(response.bodyText) as T;
}

export function host(test: AbpIntegratedTest): AbpHttpHost {
  return new AbpHttpHost(test.application);
}

export const AuthenticatedHeaders = { "x-test-user": "john" };
export const TenantHeaders = { "x-test-user": "john", "x-test-tenant": "acme" };

