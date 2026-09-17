import { AbpModule, DependsOn, Transient, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuthenticationOptions, AuthenticateResult, type AbpHttpContext, type IAuthenticationHandler } from "@abp/aws-lambda";
import { IEmailSender, type EmailSendArgs, type MailMessage } from "@abp/emailing";
import { AbpUserClaimsPrincipalFactory, IdentityUserManager } from "@abp/identity/domain";
import { AbpIdentityMemoryDbModule } from "@abp/identity/memory-db";
import { AbpPermissionManagementDomainIdentityModule } from "@abp/permission-management/domain";
import { AbpPermissionManagementMemoryDbModule } from "@abp/permission-management/memory-db";
import { AbpTestBaseModule } from "@abp/test-base";
import { AbpAccountApplicationModule, AppUrlOptions } from "../src/application/index.js";
import { AbpAccountHttpApiModule } from "../src/http-api/index.js";

export const testRootUrl = "https://app.example.com";

/** Captures the e-mails the account module sends. */
export class FakeEmailSender implements IEmailSender {
  readonly sent: EmailSendArgs[] = [];

  async send(args: EmailSendArgs): Promise<void> {
    this.sent.push(args);
  }
  async sendMail(mail: MailMessage): Promise<void> {
    this.sent.push({ to: mail.to.join(","), subject: mail.subject ?? "", body: mail.body ?? "" });
  }
  async queue(args: EmailSendArgs): Promise<void> {
    this.sent.push(args);
  }
  last(): EmailSendArgs {
    const last = this.sent.at(-1);
    if (!last) throw new Error("No e-mail was sent.");
    return last;
  }
}

export const emailSender = new FakeEmailSender();

/** Authenticates the user named by the `x-test-user` header with the claims the identity module builds for that user. */
@Transient()
export class HeaderAuthenticationHandler implements IAuthenticationHandler {
  static readonly inject = [IdentityUserManager, AbpUserClaimsPrincipalFactory] as const;

  constructor(
    private readonly userManager: IdentityUserManager,
    private readonly principalFactory: AbpUserClaimsPrincipalFactory,
  ) {}

  async authenticate(context: AbpHttpContext): Promise<AuthenticateResult> {
    const userName = context.request.headers.get("x-test-user");
    if (!userName) return AuthenticateResult.noResult();
    const user = await this.userManager.findByName(userName);
    if (!user) return AuthenticateResult.noResult();
    return AuthenticateResult.success(await this.principalFactory.create(user));
  }
}

@DependsOn(AbpAccountApplicationModule, AbpAccountHttpApiModule, AbpIdentityMemoryDbModule, AbpPermissionManagementMemoryDbModule, AbpPermissionManagementDomainIdentityModule, AbpTestBaseModule)
export class AccountTestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addType(HeaderAuthenticationHandler);
    context.services.addSingleton(IEmailSender, { useValue: emailSender });
    this.configure(AbpAuthenticationOptions, (options) => options.addScheme("Test", HeaderAuthenticationHandler));
    this.configure(AppUrlOptions, (options) => options.setRootUrl("MVC", testRootUrl));
  }
}
