import { Dependency, ICancellationTokenProvider, Singleton, Transient, optionsToken, type IOptions } from "@abp/core";
import { HttpMethodHelper } from "@abp/http";
import { IAmbientUnitOfWork, IUnitOfWorkManager, IUnitOfWorkTransactionBehaviourProvider, UnitOfWorkReservationName, hasActiveChildUnitOfWorks } from "@abp/uow";
import { IHttpContextAccessor, type AbpHttpContext } from "../http-context.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";

/** Port of `AbpAspNetCoreUnitOfWorkOptions`. */
export class AbpAspNetCoreUnitOfWorkOptions {
  /** URL prefixes for which the unit of work middleware is disabled. */
  readonly ignoredUrls: string[] = [];
  /** Completes the request unit of work right before the response starts instead of at the end of the pipeline. */
  completeUnitOfWorkOnResponseStarting = false;
  readonly completeUnitOfWorkOnResponseStartingUrls: string[] = [];
}

/** Port of `AspNetCoreUnitOfWorkTransactionBehaviourProviderOptions`. */
export class AspNetCoreUnitOfWorkTransactionBehaviourProviderOptions {
  readonly nonTransactionalUrls: string[] = ["/connect/"];
}

/** Port of `AspNetCoreUnitOfWorkTransactionBehaviourProvider`: GET/QUERY requests and `/connect/` URLs are not transactional. */
@Dependency({ replaceServices: true })
@Singleton(IUnitOfWorkTransactionBehaviourProvider)
export class AspNetCoreUnitOfWorkTransactionBehaviourProvider implements IUnitOfWorkTransactionBehaviourProvider {
  static readonly inject = [IHttpContextAccessor, optionsToken(AspNetCoreUnitOfWorkTransactionBehaviourProviderOptions)] as const;
  private readonly options: AspNetCoreUnitOfWorkTransactionBehaviourProviderOptions;

  constructor(
    private readonly httpContextAccessor: IHttpContextAccessor,
    options: IOptions<AspNetCoreUnitOfWorkTransactionBehaviourProviderOptions>,
  ) {
    this.options = options.value;
  }

  get isTransactional(): boolean | undefined {
    const httpContext = this.httpContextAccessor.httpContext;
    if (!httpContext) return undefined;
    const currentUrl = httpContext.request.path.toLowerCase();
    if (this.options.nonTransactionalUrls.some((url) => currentUrl.startsWith(url.toLowerCase()))) return false;
    const method = httpContext.request.method;
    return !(HttpMethodHelper.isGet(method) || HttpMethodHelper.isQuery(method));
  }
}

/**
 * Port of `AbpUnitOfWorkMiddleware`: reserves the request unit of work (`_AbpActionUnitOfWork`) that the action
 * filter later begins, and completes it after the pipeline. The reservation runs in a forked ambient context.
 */
@Transient()
export class AbpUnitOfWorkMiddleware extends AbpMiddlewareBase {
  static readonly inject = [IUnitOfWorkManager, optionsToken(AbpAspNetCoreUnitOfWorkOptions), ICancellationTokenProvider, IAmbientUnitOfWork] as const;
  private readonly options: AbpAspNetCoreUnitOfWorkOptions;

  constructor(
    private readonly unitOfWorkManager: IUnitOfWorkManager,
    options: IOptions<AbpAspNetCoreUnitOfWorkOptions>,
    private readonly cancellationTokenProvider: ICancellationTokenProvider,
    private readonly ambientUnitOfWork: IAmbientUnitOfWork,
  ) {
    super();
    this.options = options.value;
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    if ((await this.shouldSkip(context)) || this.isIgnoredUrl(context)) {
      await next(context);
      return;
    }

    await this.ambientUnitOfWork.fork(async () => {
      const uow = this.unitOfWorkManager.reserve(UnitOfWorkReservationName);
      try {
        let completionStarted = false;
        if (!context.response.hasStarted && this.shouldCompleteOnResponseStarting(context)) {
          context.response.onStarting(async () => {
            if (!completionStarted && this.unitOfWorkManager.current === uow && !hasActiveChildUnitOfWorks(uow)) {
              completionStarted = true;
              await uow.complete();
            }
          });
        }

        await next(context);

        if (!completionStarted) {
          completionStarted = true;
          await uow.complete();
        }
      } finally {
        await uow.dispose();
      }
    });
  }

  private isIgnoredUrl(context: AbpHttpContext): boolean {
    const path = context.request.path.toLowerCase();
    return this.options.ignoredUrls.some((url) => path.startsWith(url.toLowerCase()));
  }

  private shouldCompleteOnResponseStarting(context: AbpHttpContext): boolean {
    if (this.options.completeUnitOfWorkOnResponseStarting) return true;
    const path = context.request.path.toLowerCase();
    return this.options.completeUnitOfWorkOnResponseStartingUrls.some((url) => path.startsWith(url.toLowerCase()));
  }

  protected get cancellationSignal(): AbortSignal | undefined {
    return this.cancellationTokenProvider.signal;
  }
}
