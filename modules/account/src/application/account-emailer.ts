import { AbpException, IStringLocalizerFactory, LocalizableString, Transient, createToken, isNullOrEmptyString, optionsToken, type IOptions, type IStringLocalizer } from "@abp/core";
import { IEmailSender, StandardEmailTemplates } from "@abp/emailing";
import type { IdentityUser } from "@abp/identity/domain";
import { ICurrentTenant, TenantResolverConsts } from "@abp/multi-tenancy-abstractions";
import { ITemplateRenderer, TemplateDefinition, TemplateDefinitionProvider, type ITemplateDefinitionContext } from "@abp/text-templating";
import { AccountResource } from "../application-contracts/index.js";

/** Port of `AccountUrlNames`. */
export const AccountUrlNames = {
  PasswordReset: "Abp.Account.PasswordReset",
} as const;

/** Port of `AccountEmailTemplates`. */
export const AccountEmailTemplates = {
  PasswordResetLink: "Abp.Account.PasswordResetLink",
} as const;

/** Port of `Volo/Abp/Account/Emailing/Templates/PasswordResetLink.tpl`. */
export const PasswordResetLinkTemplate = `<h3>{{L "PasswordReset"}}</h3>

<p>{{L "PasswordResetInfoInEmail"}}</p>

<div>
    <a href="{{model.link}}">{{L "ResetMyPassword"}}</a>
</div>`;

/** Port of `AccountEmailTemplateDefinitionProvider` (the template content is registered in memory by the module). */
@Transient()
export class AccountEmailTemplateDefinitionProvider extends TemplateDefinitionProvider {
  define(context: ITemplateDefinitionContext): void {
    context.add(
      new TemplateDefinition(AccountEmailTemplates.PasswordResetLink, {
        displayName: LocalizableString.create(AccountResource, `TextTemplate:${AccountEmailTemplates.PasswordResetLink}`),
        layout: StandardEmailTemplates.Layout,
        localizationResource: AccountResource,
        isInlineLocalized: true,
      }),
    );
  }
}

/** Port of `ApplicationUrlConfiguration` / `AppUrlOptions` (`Volo.Abp.UI.Navigation`), reduced to the URL map the account module needs. */
export class AppUrlOptions {
  readonly applications = new Map<string, Map<string, string>>();

  /** `options.applications["MVC"].urls["Abp.Account.PasswordReset"] = "Account/ResetPassword"` in .NET. */
  setUrl(appName: string, urlName: string, url: string): this {
    let urls = this.applications.get(appName);
    if (!urls) {
      urls = new Map();
      this.applications.set(appName, urls);
    }
    urls.set(urlName, url);
    return this;
  }

  /** The root URL of an application (`RootUrl`); relative URLs are appended to it. */
  setRootUrl(appName: string, rootUrl: string): this {
    return this.setUrl(appName, "RootUrl", rootUrl);
  }
}

/** Port of `IAppUrlProvider`. */
export interface IAppUrlProvider {
  getUrl(appName: string, urlName?: string): Promise<string>;
}
export const IAppUrlProvider = createToken<IAppUrlProvider>("IAppUrlProvider");

/** Port of `AppUrlProvider` over `AppUrlOptions`: `RootUrl` + the named relative URL. */
@Transient(IAppUrlProvider)
export class AppUrlProvider implements IAppUrlProvider {
  static readonly inject = [optionsToken(AppUrlOptions)] as const;

  constructor(private readonly options: IOptions<AppUrlOptions>) {}

  async getUrl(appName: string, urlName?: string): Promise<string> {
    const urls = this.options.value.applications.get(appName);
    if (!urls) throw new AbpException(`No URL configuration found for the application '${appName}'. Configure AppUrlOptions.`);
    const rootUrl = urls.get("RootUrl") ?? "";
    if (urlName === undefined) return rootUrl;
    const url = urls.get(urlName);
    if (url === undefined) throw new AbpException(`No URL named '${urlName}' is configured for the application '${appName}'.`);
    if (/^https?:\/\//i.test(url)) return url;
    return `${rootUrl.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  }
}

/** Port of `IAccountEmailer`. */
export interface IAccountEmailer {
  sendPasswordResetLink(user: IdentityUser, resetToken: string, appName: string, returnUrl?: string, returnUrlHash?: string): Promise<void>;
}
export const IAccountEmailer = createToken<IAccountEmailer>("IAccountEmailer");

/** Port of `AccountEmailer`: renders `Abp.Account.PasswordResetLink` and sends it through `IEmailSender`. */
@Transient(IAccountEmailer)
export class AccountEmailer implements IAccountEmailer {
  static readonly inject = [IEmailSender, ITemplateRenderer, IStringLocalizerFactory, IAppUrlProvider, ICurrentTenant] as const;
  protected readonly stringLocalizer: IStringLocalizer;

  constructor(
    protected readonly emailSender: IEmailSender,
    protected readonly templateRenderer: ITemplateRenderer,
    stringLocalizerFactory: IStringLocalizerFactory,
    protected readonly appUrlProvider: IAppUrlProvider,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    this.stringLocalizer = stringLocalizerFactory.create(AccountResource);
  }

  async sendPasswordResetLink(user: IdentityUser, resetToken: string, appName: string, returnUrl?: string, returnUrlHash?: string): Promise<void> {
    const url = await this.appUrlProvider.getUrl(appName, AccountUrlNames.PasswordReset);
    let link = `${url}?userId=${user.id}&${TenantResolverConsts.defaultTenantKey}=${user.tenantId ?? ""}&resetToken=${encodeURIComponent(resetToken)}`;
    if (!isNullOrEmptyString(returnUrl)) link += `&returnUrl=${this.normalizeReturnUrl(returnUrl)}`;
    if (!isNullOrEmptyString(returnUrlHash)) link += `&returnUrlHash=${returnUrlHash}`;

    const emailContent = await this.templateRenderer.render(AccountEmailTemplates.PasswordResetLink, { link });
    await this.emailSender.send({ to: user.email, subject: this.stringLocalizer.t("PasswordReset"), body: emailContent });
  }

  protected normalizeReturnUrl(returnUrl: string): string {
    if (isNullOrEmptyString(returnUrl)) return returnUrl;
    if (returnUrl.toLowerCase().startsWith("/connect/authorize/callback") && returnUrl.includes("?")) {
      const queryPart = returnUrl.split("?")[1] ?? "";
      for (const queryParameter of queryPart.split("&")) {
        const [name, value] = queryParameter.split("=");
        if (name === "redirect_uri" && value !== undefined) return decodeURIComponent(value);
      }
    }
    if (returnUrl.toLowerCase().startsWith("/connect/authorize?")) return encodeURIComponent(returnUrl);
    return returnUrl;
  }
}
