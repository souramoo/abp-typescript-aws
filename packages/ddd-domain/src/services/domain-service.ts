import { AbpException, ILoggerFactory, IStringLocalizerFactory, NullLogger, createClassMarker, type Class, type IAbpLazyServiceProvider, type ILogger, type IStringLocalizer } from "@abp/core";
import { IGuidGenerator, SimpleGuidGenerator } from "@abp/guids";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IClock } from "@abp/timing";
import { IUnitOfWorkManager, type IUnitOfWork } from "@abp/uow";

/**
 * Port of the `IDomainService` marker interface (`ITransientDependency` in .NET). Subclasses of `DomainService` carry
 * it automatically; they still need their own `@Transient()` for conventional registration.
 */
export const IDomainService = createClassMarker("IDomainService");

/** Port of `DomainService`: the property-injected helpers of ABP domain services (`AsyncExecuter` has no counterpart). */
export abstract class DomainService {
  lazyServiceProvider!: IAbpLazyServiceProvider;
  private localizer: IStringLocalizer | undefined;
  private localizationResourceType: Class | undefined;

  protected get clock(): IClock {
    return this.lazyServiceProvider.lazyGetRequiredService(IClock);
  }
  protected get guidGenerator(): IGuidGenerator {
    return this.lazyServiceProvider.lazyGetServiceOr(IGuidGenerator, SimpleGuidGenerator.instance);
  }
  protected get loggerFactory(): ILoggerFactory {
    return this.lazyServiceProvider.lazyGetRequiredService(ILoggerFactory);
  }
  protected get currentTenant(): ICurrentTenant {
    return this.lazyServiceProvider.lazyGetRequiredService(ICurrentTenant);
  }
  protected get unitOfWorkManager(): IUnitOfWorkManager {
    return this.lazyServiceProvider.lazyGetRequiredService(IUnitOfWorkManager);
  }
  protected get currentUnitOfWork(): IUnitOfWork | undefined {
    return this.unitOfWorkManager.current;
  }
  protected get logger(): ILogger {
    return this.lazyServiceProvider.lazyGetServiceFrom(ILoggerFactory, (provider) => provider.get(ILoggerFactory)?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }
  protected get stringLocalizerFactory(): IStringLocalizerFactory {
    return this.lazyServiceProvider.lazyGetRequiredService(IStringLocalizerFactory);
  }

  /** The localization resource class used by {@link L}; undefined uses the default resource. */
  protected get localizationResource(): Class | undefined {
    return this.localizationResourceType;
  }
  protected set localizationResource(value: Class | undefined) {
    this.localizationResourceType = value;
    this.localizer = undefined;
  }

  protected get L(): IStringLocalizer {
    this.localizer ??= this.createLocalizer();
    return this.localizer;
  }

  protected createLocalizer(): IStringLocalizer {
    if (this.localizationResource) return this.stringLocalizerFactory.create(this.localizationResource);
    const localizer = this.stringLocalizerFactory.createDefaultOrNull();
    if (!localizer) throw new AbpException("Set localizationResource or define the default localization resource type (AbpLocalizationOptions.defaultResourceType) to be able to use the L object!");
    return localizer;
  }
}
IDomainService.mark(DomainService);
