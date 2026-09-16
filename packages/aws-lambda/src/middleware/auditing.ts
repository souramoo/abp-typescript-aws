import { ILoggerFactory, LogLevel, Transient, forkAmbientScope, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { AbpAuditingOptions, AuditLogContributor, IAuditingManager, type AuditLogContributionContext, type AuditLogInfo, type IAuditLogSaveHandle } from "@abp/auditing";
import { AbpAspNetCoreConsts, HttpMethodHelper, IHttpExceptionStatusCodeFinder } from "@abp/http";
import { ICurrentUser } from "@abp/security";
import { IUnitOfWorkManager } from "@abp/uow";
import { IHttpContextAccessor, type AbpHttpContext } from "../http-context.js";
import { IWebClientInfoProvider } from "../web-client-info.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";

/** Port of `AbpAspNetCoreAuditingOptions`. */
export class AbpAspNetCoreAuditingOptions {
  /** URL prefixes for which the auditing middleware is disabled. */
  readonly ignoredUrls: string[] = [];
}

/** Port of `AbpAspNetCoreAuditingUrlOptions`. */
export class AbpAspNetCoreAuditingUrlOptions {
  includeSchema = false;
  includeHost = false;
  includeQuery = false;
}

/** Port of `AspNetCoreAuditLogContributor`: HTTP method, URL, client IP, browser and the final status code. */
export class AspNetCoreAuditLogContributor extends AuditLogContributor {
  override preContribute(context: AuditLogContributionContext): void {
    const httpContext = context.serviceProvider.get(IHttpContextAccessor)?.httpContext;
    if (!httpContext) return;

    context.auditInfo.httpMethod ??= httpContext.request.method;
    context.auditInfo.url ??= this.getUrl(context, httpContext);

    const clientInfoProvider = context.serviceProvider.getRequired(IWebClientInfoProvider);
    context.auditInfo.clientIpAddress ??= clientInfoProvider.clientIpAddress;
    context.auditInfo.browserInfo ??= clientInfoProvider.browserInfo;
  }

  override postContribute(context: AuditLogContributionContext): void {
    if (context.auditInfo.httpStatusCode !== undefined) return;
    const httpContext = context.serviceProvider.get(IHttpContextAccessor)?.httpContext;
    if (!httpContext) return;

    if (context.auditInfo.exceptions.length > 0) {
      const finder = context.serviceProvider.getRequired(IHttpExceptionStatusCodeFinder);
      for (const exception of context.auditInfo.exceptions) context.auditInfo.httpStatusCode = finder.getStatusCode(httpContext, exception);
      if (context.auditInfo.httpStatusCode !== undefined) return;
    }
    context.auditInfo.httpStatusCode = httpContext.response.statusCode;
  }

  protected getUrl(context: AuditLogContributionContext, httpContext: AbpHttpContext): string {
    const options = context.serviceProvider.getOptions(AbpAspNetCoreAuditingUrlOptions);
    let url = "";
    if (options.includeSchema) url += `${httpContext.request.scheme}://`;
    if (options.includeHost) url += httpContext.request.host ?? "";
    url += httpContext.request.path;
    if (options.includeQuery) url += httpContext.request.queryString;
    return url;
  }
}

/**
 * Port of `AbpAuditingMiddleware`: one audit log scope per request, saved after the pipeline when the auditing
 * options say so. The scope is begun in a forked ambient context so it never leaks past the request.
 */
@Transient()
export class AbpAuditingMiddleware extends AbpMiddlewareBase {
  static readonly inject = [IAuditingManager, ICurrentUser, optionsToken(AbpAuditingOptions), optionsToken(AbpAspNetCoreAuditingOptions), IUnitOfWorkManager, ILoggerFactory] as const;
  protected readonly auditingOptions: AbpAuditingOptions;
  protected readonly aspNetCoreAuditingOptions: AbpAspNetCoreAuditingOptions;
  protected readonly logger: ILogger;

  constructor(
    private readonly auditingManager: IAuditingManager,
    protected readonly currentUser: ICurrentUser,
    auditingOptions: IOptions<AbpAuditingOptions>,
    aspNetCoreAuditingOptions: IOptions<AbpAspNetCoreAuditingOptions>,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    loggerFactory: ILoggerFactory,
  ) {
    super();
    this.auditingOptions = auditingOptions.value;
    this.aspNetCoreAuditingOptions = aspNetCoreAuditingOptions.value;
    this.logger = loggerFactory.createLogger(AbpAuditingMiddleware.name);
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    if ((await this.shouldSkip(context)) || !this.auditingOptions.isEnabled || this.isIgnoredUrl(context)) {
      await next(context);
      return;
    }

    await forkAmbientScope(async () => {
      let hasError = false;
      const saveHandle = this.auditingManager.beginScope();
      try {
        const log = this.auditingManager.current!.log;
        try {
          await next(context);
          if (log.exceptions.length > 0) hasError = true;
        } catch (e) {
          hasError = true;
          if (!log.exceptions.includes(e)) log.exceptions.push(e);
          throw e;
        } finally {
          if (await this.shouldWriteAuditLog(log, context, hasError)) {
            const currentUow = this.unitOfWorkManager.current;
            if (currentUow) {
              try {
                await currentUow.saveChanges();
              } catch (e) {
                if (!log.exceptions.includes(e)) log.exceptions.push(e);
              }
            }
            await this.save(saveHandle);
          }
        }
      } finally {
        saveHandle.dispose();
      }
    });
  }

  private async save(saveHandle: IAuditLogSaveHandle): Promise<void> {
    try {
      await saveHandle.save();
    } catch (e) {
      if (!this.auditingOptions.hideErrors) throw e;
      this.logger.logException(e, LogLevel.Error);
    }
  }

  private isIgnoredUrl(context: AbpHttpContext): boolean {
    const path = context.request.path.toLowerCase();
    if (!this.auditingOptions.isEnabledForIntegrationServices && path.startsWith(`/${AbpAspNetCoreConsts.DefaultIntegrationServiceApiPrefix}/`)) return true;
    return this.aspNetCoreAuditingOptions.ignoredUrls.some((url) => path.startsWith(url.toLowerCase()));
  }

  private async shouldWriteAuditLog(auditLogInfo: AuditLogInfo, context: AbpHttpContext, hasError: boolean): Promise<boolean> {
    for (const selector of this.auditingOptions.alwaysLogSelectors) {
      if (await selector(auditLogInfo)) return true;
    }
    if (this.auditingOptions.alwaysLogOnException && hasError) return true;
    if (!this.auditingOptions.isEnabledForAnonymousUsers && !this.currentUser.isAuthenticated) return false;
    const method = context.request.method;
    if (!this.auditingOptions.isEnabledForGetRequests && (HttpMethodHelper.isGet(method) || HttpMethodHelper.isHead(method) || HttpMethodHelper.isQuery(method))) return false;
    return true;
  }
}
