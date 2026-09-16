import { BusinessException, CultureHelper, Dependency, ILoggerFactory, Transient, formatNamed, isNullOrWhiteSpace, optionsToken, removePreFix, type Guid, type ILogger, type IOptions } from "@abp/core";
import { AbpHttpConsts, HttpStatusCode, RemoteServiceErrorInfo, RemoteServiceErrorResponse } from "@abp/http";
import { IJsonSerializer } from "@abp/json";
import { LocalizationSettingNames } from "@abp/localization";
import { CurrentUserTenantResolveContributor } from "@abp/multi-tenancy";
import { ICurrentTenant, ITenantConfigurationProvider, ITenantResolveResultAccessor, TenantResolveContributorBase, TenantResolverConsts, type ITenantResolveContext, type TenantConfiguration, type TenantResolveResult } from "@abp/multi-tenancy-abstractions";
import { ISettingProvider } from "@abp/settings";
import { IHttpContextAccessor, type AbpHttpContext } from "../http-context.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";
import { AbpRequestCultureCookieHelper, AbpRequestLocalizationOptions, RequestCultureItemName, type RequestCulture } from "./request-localization.js";

/** Port of `AbpAspNetCoreMultiTenancyOptions`. */
export class AbpAspNetCoreMultiTenancyOptions {
  /** Default: `__tenant`. */
  tenantKey: string = TenantResolverConsts.defaultTenantKey;

  /**
   * Port of `MultiTenancyMiddlewareErrorPageBuilder`: returns true to stop the pipeline. The default deletes a stale
   * tenant cookie, sets the `Abp-Tenant-Resolve-Error` header and writes a 404 `RemoteServiceErrorResponse` (no HTML page).
   */
  multiTenancyMiddlewareErrorPageBuilder: (context: AbpHttpContext, exception: unknown) => Promise<boolean> = async (context, exception) => {
    const tenantResolveResult = context.serviceProvider.getRequired(ITenantResolveResultAccessor).result;
    const options = context.serviceProvider.getOptions(AbpAspNetCoreMultiTenancyOptions);
    if (tenantResolveResult && (tenantResolveResult.appliedResolvers.includes(CookieTenantResolveContributor.ContributorName) || context.request.cookies.has(options.tenantKey))) {
      AbpMultiTenancyCookieHelper.setTenantCookie(context, undefined, options.tenantKey);
    }

    const message = exception instanceof Error ? exception.message : String(exception);
    context.response.headers.set(AbpHttpConsts.AbpTenantResolveError, encodeHeaderValue(message));
    const details = exception instanceof BusinessException ? exception.details : undefined;
    await context.response.json(new RemoteServiceErrorResponse(new RemoteServiceErrorInfo(message, details ?? "")), context.serviceProvider.getRequired(IJsonSerializer), HttpStatusCode.NotFound);
    return true;
  };
}

function encodeHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, (c) => encodeURIComponent(c)).replace(/[\r\n]/g, " ");
}

/** Port of `AbpMultiTenancyCookieHelper`. */
export const AbpMultiTenancyCookieHelper = {
  setTenantCookie(context: AbpHttpContext, tenantId: Guid | undefined, tenantKey: string): void {
    if (tenantId !== undefined) {
      context.response.setCookie(tenantKey, tenantId, { path: "/", httpOnly: false, expires: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) });
    } else {
      context.response.deleteCookie(tenantKey, { path: "/" });
    }
  },
};

/** Port of `TenantResolveContextExtensions.GetAbpAspNetCoreMultiTenancyOptions`. */
export function getAbpAspNetCoreMultiTenancyOptions(context: ITenantResolveContext): AbpAspNetCoreMultiTenancyOptions {
  return context.serviceProvider.getOptions(AbpAspNetCoreMultiTenancyOptions);
}

/** Port of `HttpTenantResolveContributorBase`: reads the current request through the ambient `IHttpContextAccessor`. */
export abstract class HttpTenantResolveContributorBase extends TenantResolveContributorBase {
  async resolve(context: ITenantResolveContext): Promise<void> {
    const httpContext = context.serviceProvider.get(IHttpContextAccessor)?.httpContext;
    if (!httpContext) return;
    try {
      await this.resolveFromHttpContext(context, httpContext);
    } catch (e) {
      context.serviceProvider.get(ILoggerFactory)?.createLogger(HttpTenantResolveContributorBase.name).warn(String(e), undefined, e);
    }
  }

  protected async resolveFromHttpContext(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<void> {
    const tenantIdOrName = await this.getTenantIdOrNameFromHttpContextOrNull(context, httpContext);
    if (!isNullOrWhiteSpace(tenantIdOrName)) context.tenantIdOrName = tenantIdOrName;
  }

  protected abstract getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined>;
}

/** Port of `QueryStringTenantResolveContributor`. */
export class QueryStringTenantResolveContributor extends HttpTenantResolveContributorBase {
  static readonly ContributorName = "QueryString";
  readonly name = QueryStringTenantResolveContributor.ContributorName;

  protected async getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined> {
    const value = httpContext.request.query.get(getAbpAspNetCoreMultiTenancyOptions(context).tenantKey);
    return value && !isNullOrWhiteSpace(value) ? value : undefined;
  }
}

/** Port of `RouteTenantResolveContributor`: `{__tenant}` route values. */
export class RouteTenantResolveContributor extends HttpTenantResolveContributorBase {
  static readonly ContributorName = "Route";
  readonly name = RouteTenantResolveContributor.ContributorName;

  protected async getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined> {
    return httpContext.request.routeValues[getAbpAspNetCoreMultiTenancyOptions(context).tenantKey];
  }
}

/** Port of `HeaderTenantResolveContributor`. */
export class HeaderTenantResolveContributor extends HttpTenantResolveContributorBase {
  static readonly ContributorName = "Header";
  readonly name = HeaderTenantResolveContributor.ContributorName;

  protected async getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined> {
    const tenantIdKey = getAbpAspNetCoreMultiTenancyOptions(context).tenantKey;
    const values = httpContext.request.headers.getAll(tenantIdKey).flatMap((v) => v.split(",").map((x) => x.trim())).filter((v) => v !== "");
    if (values.length === 0) return undefined;
    if (values.length > 1) this.log(context, `HTTP request includes more than one ${tenantIdKey} header value. First one will be used. All of them: ${values.join(", ")}`);
    return values[0];
  }

  protected log(context: ITenantResolveContext, text: string): void {
    context.serviceProvider.get(ILoggerFactory)?.createLogger(HeaderTenantResolveContributor.name).warn(text);
  }
}

/** Port of `CookieTenantResolveContributor`. */
export class CookieTenantResolveContributor extends HttpTenantResolveContributorBase {
  static readonly ContributorName = "Cookie";
  readonly name = CookieTenantResolveContributor.ContributorName;

  protected async getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined> {
    return httpContext.request.cookies.get(getAbpAspNetCoreMultiTenancyOptions(context).tenantKey);
  }
}

/** Port of `FormTenantResolveContributor` (obsolete in .NET, kept for form posts). */
export class FormTenantResolveContributor extends HttpTenantResolveContributorBase {
  static readonly ContributorName = "Form";
  readonly name = FormTenantResolveContributor.ContributorName;

  protected async getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined> {
    if (!httpContext.request.hasFormContentType) return undefined;
    return httpContext.request.form().get(getAbpAspNetCoreMultiTenancyOptions(context).tenantKey) ?? undefined;
  }
}

const protocolPrefixes = ["http://", "https://"];

/** Port of `DomainTenantResolveContributor`: `{0}.mydomain.com` (the placeholder is the tenant name/id). */
export class DomainTenantResolveContributor extends HttpTenantResolveContributorBase {
  static readonly ContributorName = "Domain";
  readonly name = DomainTenantResolveContributor.ContributorName;
  private readonly domainFormat: string;

  constructor(domainFormat: string) {
    super();
    this.domainFormat = removePreFix(domainFormat, ...protocolPrefixes);
  }

  protected async getTenantIdOrNameFromHttpContextOrNull(context: ITenantResolveContext, httpContext: AbpHttpContext): Promise<string | undefined> {
    const host = httpContext.request.host;
    if (!host) return undefined;
    const hostName = removePreFix(host, ...protocolPrefixes);
    context.handled = true;
    return extractDomainPlaceholder(hostName, this.domainFormat);
  }
}

/** Port of `FormattedStringValueExtracter.Extract(host, "{0}.mydomain.com", ignoreCase: true)` for one placeholder. */
export function extractDomainPlaceholder(hostName: string, format: string): string | undefined {
  const index = format.indexOf("{0}");
  if (index < 0) return hostName.toLowerCase() === format.toLowerCase() ? undefined : undefined;
  const prefix = format.slice(0, index).toLowerCase();
  const suffix = format.slice(index + 3).toLowerCase();
  const lowerHost = hostName.toLowerCase();
  if (!lowerHost.startsWith(prefix) || !lowerHost.endsWith(suffix) || lowerHost.length <= prefix.length + suffix.length) return undefined;
  const value = hostName.slice(prefix.length, hostName.length - suffix.length);
  return value === "" ? undefined : value;
}

/** Port of `AbpMultiTenancyOptionsExtensions.AddDomainTenantResolver`: inserted right after the current-user resolver. */
export function addDomainTenantResolver(options: { tenantResolvers: TenantResolveContributorBase[] }, domainFormat: string): void {
  const index = options.tenantResolvers.findIndex((r) => r instanceof CurrentUserTenantResolveContributor);
  options.tenantResolvers.splice(index + 1, 0, new DomainTenantResolveContributor(domainFormat));
}

/** Port of `HttpContextTenantResolveResultAccessor`: the resolve result lives on the request. */
@Dependency({ replaceServices: true })
@Transient(ITenantResolveResultAccessor)
export class HttpContextTenantResolveResultAccessor implements ITenantResolveResultAccessor {
  static readonly inject = [IHttpContextAccessor] as const;
  static readonly HttpContextItemName = "__AbpTenantResolveResult";

  constructor(private readonly httpContextAccessor: IHttpContextAccessor) {}

  get result(): TenantResolveResult | undefined {
    return this.httpContextAccessor.httpContext?.tenantResolveResult;
  }

  set result(value: TenantResolveResult | undefined) {
    const httpContext = this.httpContextAccessor.httpContext;
    if (!httpContext) return;
    httpContext.tenantResolveResult = value;
    httpContext.items.set(HttpContextTenantResolveResultAccessor.HttpContextItemName, value);
  }
}

/** Port of `MultiTenancyMiddleware`. */
@Transient()
export class MultiTenancyMiddleware extends AbpMiddlewareBase {
  static readonly inject = [ITenantConfigurationProvider, ICurrentTenant, optionsToken(AbpAspNetCoreMultiTenancyOptions), ITenantResolveResultAccessor, ILoggerFactory] as const;
  private readonly options: AbpAspNetCoreMultiTenancyOptions;
  protected readonly logger: ILogger;

  constructor(
    private readonly tenantConfigurationProvider: ITenantConfigurationProvider,
    private readonly currentTenant: ICurrentTenant,
    options: IOptions<AbpAspNetCoreMultiTenancyOptions>,
    private readonly tenantResolveResultAccessor: ITenantResolveResultAccessor,
    loggerFactory: ILoggerFactory,
  ) {
    super();
    this.options = options.value;
    this.logger = loggerFactory.createLogger(MultiTenancyMiddleware.name);
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    let tenant: TenantConfiguration | undefined;
    try {
      tenant = await this.tenantConfigurationProvider.get(true);
    } catch (e) {
      this.logger.logException(e);
      if (await this.options.multiTenancyMiddlewareErrorPageBuilder(context, e)) return;
    }

    if (tenant?.id === this.currentTenant.id) {
      await next(context);
      return;
    }

    await this.currentTenant.run(tenant?.id, tenant?.name, async () => {
      if (this.tenantResolveResultAccessor.result?.appliedResolvers.includes(QueryStringTenantResolveContributor.ContributorName)) {
        AbpMultiTenancyCookieHelper.setTenantCookie(context, this.currentTenant.id, this.options.tenantKey);
      }

      const requestCulture = await this.tryGetRequestCulture(context);
      if (requestCulture) {
        context.items.set(RequestCultureItemName, requestCulture);
        AbpRequestCultureCookieHelper.setCultureCookie(context, requestCulture, context.serviceProvider.getOptions(AbpRequestLocalizationOptions).cookieName);
        await CultureHelper.run(requestCulture.culture, () => next(context), requestCulture.uiCulture);
        return;
      }
      await next(context);
    });
  }

  /** The tenant's default language applies when the request localization middleware fell back to the default culture. */
  private async tryGetRequestCulture(context: AbpHttpContext): Promise<RequestCulture | undefined> {
    const current = context.items.get(RequestCultureItemName) as RequestCulture | undefined;
    if (!current || current.provider !== undefined) return undefined;

    const settingProvider = context.serviceProvider.get(ISettingProvider);
    if (!settingProvider) return undefined;
    const defaultLanguage = await settingProvider.getOrNull(LocalizationSettingNames.DefaultLanguage);
    if (isNullOrWhiteSpace(defaultLanguage)) return undefined;

    const [culture, uiCulture = culture] = defaultLanguage.split(";") as [string, string?];
    if (CultureHelper.isValidCultureCode(culture) && CultureHelper.isValidCultureCode(uiCulture)) return { culture, uiCulture, provider: undefined };
    return undefined;
  }
}

export { formatNamed };
