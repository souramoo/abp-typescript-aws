import { AbpException, DisableInterception, ILoggerFactory, IStringLocalizerFactory, NullLogger, type Class, type IAbpLazyServiceProvider, type ILogger, type IStringLocalizer } from "@abp/core";
import { IAbpAuthorizationService } from "@abp/authorization";
import { IFeatureChecker } from "@abp/features";
import { DefaultResource } from "@abp/localization";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ICurrentUser } from "@abp/security";
import { IClock } from "@abp/timing";
import { IUnitOfWorkManager, type IUnitOfWork } from "@abp/uow";
import { IHttpContextAccessor, type AbpHttpContext } from "../http-context.js";
import { ModelState, ModelStateValidator } from "./model-binder.js";
import { ModelStateItemName } from "./mvc-middleware.js";

/**
 * Port of `AbpControllerBase`: convenience accessors resolved lazily through the container-set `lazyServiceProvider`.
 * Subclasses need their own `@Transient()` (or explicit registration) and `@Controller(...)`.
 */
export abstract class AbpControllerBase {
  lazyServiceProvider!: IAbpLazyServiceProvider;
  private localizer: IStringLocalizer | undefined;
  private localizationResourceType: Class | undefined = DefaultResource;

  protected get httpContext(): AbpHttpContext {
    const context = this.lazyServiceProvider.lazyGetRequiredService(IHttpContextAccessor).httpContext;
    if (!context) throw new AbpException("There is no active HTTP context.");
    return context;
  }

  protected get unitOfWorkManager(): IUnitOfWorkManager {
    return this.lazyServiceProvider.lazyGetRequiredService(IUnitOfWorkManager);
  }

  protected get currentUnitOfWork(): IUnitOfWork | undefined {
    return this.unitOfWorkManager.current;
  }

  protected get loggerFactory(): ILoggerFactory {
    return this.lazyServiceProvider.lazyGetRequiredService(ILoggerFactory);
  }

  protected get logger(): ILogger {
    return this.lazyServiceProvider.lazyGetServiceFrom(ILoggerFactory, (provider) => provider.get(ILoggerFactory)?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }

  protected get currentUser(): ICurrentUser {
    return this.lazyServiceProvider.lazyGetRequiredService(ICurrentUser);
  }

  protected get currentTenant(): ICurrentTenant {
    return this.lazyServiceProvider.lazyGetRequiredService(ICurrentTenant);
  }

  protected get authorizationService(): IAbpAuthorizationService {
    return this.lazyServiceProvider.lazyGetRequiredService(IAbpAuthorizationService);
  }

  protected get clock(): IClock {
    return this.lazyServiceProvider.lazyGetRequiredService(IClock);
  }

  protected get featureChecker(): IFeatureChecker {
    return this.lazyServiceProvider.lazyGetRequiredService(IFeatureChecker);
  }

  protected get stringLocalizerFactory(): IStringLocalizerFactory {
    return this.lazyServiceProvider.lazyGetRequiredService(IStringLocalizerFactory);
  }

  protected get L(): IStringLocalizer {
    this.localizer ??= this.createLocalizer();
    return this.localizer;
  }

  protected get localizationResource(): Class | undefined {
    return this.localizationResourceType;
  }

  protected set localizationResource(value: Class | undefined) {
    this.localizationResourceType = value;
    this.localizer = undefined;
  }

  /** Port of `ModelState`: the binding errors of the current action. */
  protected get modelState(): ModelState {
    return (this.httpContext.items.get(ModelStateItemName) as ModelState | undefined) ?? new ModelState();
  }

  @DisableInterception()
  protected validateModel(): void {
    ModelStateValidator.validate(this.modelState);
  }

  protected createLocalizer(): IStringLocalizer {
    if (this.localizationResourceType) return this.stringLocalizerFactory.create(this.localizationResourceType);
    const localizer = this.stringLocalizerFactory.createDefaultOrNull();
    if (!localizer) throw new AbpException("Set localizationResource or define the default localization resource type (AbpLocalizationOptions.defaultResourceType) to be able to use the L object!");
    return localizer;
  }
}

/** Port of `AbpController` (same as the base here: no view support). */
export abstract class AbpController extends AbpControllerBase {}
