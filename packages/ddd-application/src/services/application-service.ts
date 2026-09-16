import { AbpException, ILoggerFactory, IStringLocalizerFactory, NullLogger, createClassMarker, isNullOrEmptyString, type Class, type IAbpLazyServiceProvider, type ILogger, type IRemoteService, type IStringLocalizer } from "@abp/core";
import { AuditingEnabled } from "@abp/auditing";
import { IAbpAuthorizationService } from "@abp/authorization";
import { IDataFilter } from "@abp/data";
import { IFeatureChecker } from "@abp/features";
import { GlobalFeatureCheckingEnabled } from "@abp/global-features";
import { IGuidGenerator, SimpleGuidGenerator } from "@abp/guids";
import { DefaultResource } from "@abp/localization";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IObjectMapper, objectMapperToken } from "@abp/object-mapping";
import { ICurrentUser } from "@abp/security";
import { ISettingProvider } from "@abp/settings";
import { IClock } from "@abp/timing";
import { IUnitOfWorkManager, UnitOfWorkEnabled, type IUnitOfWork } from "@abp/uow";
import { ValidationEnabled } from "@abp/validation";

/**
 * Port of `IApplicationService` (`IRemoteService`). The class marker identifies application services for the HTTP
 * layer; subclasses of `ApplicationService` carry it automatically, other classes use `@IApplicationService()`.
 */
export interface IApplicationService extends IRemoteService {
  readonly __applicationService?: true;
}
export const IApplicationService = createClassMarker("IApplicationService");

/**
 * Port of `ApplicationService`. Carries the interceptor markers `ValidationEnabled`, `UnitOfWorkEnabled`,
 * `AuditingEnabled` and `GlobalFeatureCheckingEnabled` (inherited by subclasses); every concrete subclass still needs
 * its own `@Transient()`. `AsyncExecuter` has no counterpart (queries are executed by `IQueryable`).
 */
export abstract class ApplicationService implements IApplicationService {
  declare readonly __remoteService?: true;
  declare readonly __applicationService?: true;
  lazyServiceProvider!: IAbpLazyServiceProvider;
  static commonPostfixes: string[] = ["AppService", "ApplicationService", "Service"];

  private localizer: IStringLocalizer | undefined;
  private localizationResourceType: Class | undefined = DefaultResource;
  /** The `IObjectMapper<TContext>` to use instead of the global mapper (port of `ObjectMapperContext`). */
  protected objectMapperContext: Class | undefined = undefined;

  protected get unitOfWorkManager(): IUnitOfWorkManager {
    return this.lazyServiceProvider.lazyGetRequiredService(IUnitOfWorkManager);
  }
  protected get objectMapper(): IObjectMapper {
    return this.lazyServiceProvider.lazyGetRequiredService(this.objectMapperContext ? objectMapperToken(this.objectMapperContext) : IObjectMapper);
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
  protected get dataFilter(): IDataFilter {
    return this.lazyServiceProvider.lazyGetRequiredService(IDataFilter);
  }
  protected get currentUser(): ICurrentUser {
    return this.lazyServiceProvider.lazyGetRequiredService(ICurrentUser);
  }
  protected get settingProvider(): ISettingProvider {
    return this.lazyServiceProvider.lazyGetRequiredService(ISettingProvider);
  }
  protected get clock(): IClock {
    return this.lazyServiceProvider.lazyGetRequiredService(IClock);
  }
  protected get authorizationService(): IAbpAuthorizationService {
    return this.lazyServiceProvider.lazyGetRequiredService(IAbpAuthorizationService);
  }
  protected get featureChecker(): IFeatureChecker {
    return this.lazyServiceProvider.lazyGetRequiredService(IFeatureChecker);
  }
  protected get stringLocalizerFactory(): IStringLocalizerFactory {
    return this.lazyServiceProvider.lazyGetRequiredService(IStringLocalizerFactory);
  }
  protected get currentUnitOfWork(): IUnitOfWork | undefined {
    return this.unitOfWorkManager.current;
  }
  protected get logger(): ILogger {
    return this.lazyServiceProvider.lazyGetServiceFrom(ILoggerFactory, (provider) => provider.get(ILoggerFactory)?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }

  protected get L(): IStringLocalizer {
    this.localizer ??= this.createLocalizer();
    return this.localizer;
  }

  /** The localization resource class of {@link L}; defaults to `DefaultResource`, undefined uses the configured default. */
  protected get localizationResource(): Class | undefined {
    return this.localizationResourceType;
  }
  protected set localizationResource(value: Class | undefined) {
    this.localizationResourceType = value;
    this.localizer = undefined;
  }

  /** Checks the policy; throws `AbpAuthorizationException` when not granted. Does nothing for an empty name. */
  protected async checkPolicy(policyName: string | null | undefined): Promise<void> {
    if (isNullOrEmptyString(policyName)) return;
    await this.authorizationService.check(policyName);
  }

  protected createLocalizer(): IStringLocalizer {
    if (this.localizationResource) return this.stringLocalizerFactory.create(this.localizationResource);
    const localizer = this.stringLocalizerFactory.createDefaultOrNull();
    if (!localizer) throw new AbpException("Set localizationResource or define the default localization resource type (AbpLocalizationOptions.defaultResourceType) to be able to use the L object!");
    return localizer;
  }
}
IApplicationService.mark(ApplicationService);
ValidationEnabled.mark(ApplicationService);
UnitOfWorkEnabled.mark(ApplicationService);
AuditingEnabled.mark(ApplicationService);
GlobalFeatureCheckingEnabled.mark(ApplicationService);
