import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuditingModule } from "@abp/auditing";
import { AbpDataModule } from "@abp/data";
import { AbpEventBusAbstractionsModule, AbpEventBusModule } from "@abp/event-bus";
import { AbpGuidsModule } from "@abp/guids";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpObjectMappingModule } from "@abp/object-mapping";
import { AbpSpecificationsModule } from "@abp/specifications";
import { AbpTimingModule } from "@abp/timing";
import { ChangeTrackingInterceptorRegistrar } from "./change-tracking/change-tracking.js";
import { installRepositoryFallbackResolver } from "./repositories/repository-registration.js";
import "./entities/events/distributed/entity-to-eto-mapper.js";
import "./entities/events/entity-change-event-helper.js";

/** Port of `AbpDddDomainSharedModule`. */
@DependsOn(AbpMultiTenancyAbstractionsModule, AbpEventBusAbstractionsModule)
export class AbpDddDomainSharedModule extends AbpModule {}

/**
 * Port of `AbpDddDomainModule`. `AbpExceptionHandlingModule` lives in `@abp/core` and `AbpCachingModule` (entity
 * caches) is not a dependency of this port. Besides the change-tracking interceptor it installs the fallback
 * resolver that lets `repositoryToken(Entity)` resolve through the default repository providers of db modules.
 */
@DependsOn(AbpAuditingModule, AbpDataModule, AbpEventBusModule, AbpGuidsModule, AbpTimingModule, AbpObjectMappingModule, AbpSpecificationsModule, AbpDddDomainSharedModule)
export class AbpDddDomainModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(ChangeTrackingInterceptorRegistrar.registerIfNeeded);
    installRepositoryFallbackResolver(context.services);
  }
}
