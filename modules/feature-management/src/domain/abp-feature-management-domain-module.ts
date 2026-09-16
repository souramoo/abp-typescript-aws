import { AbpModule, DependsOn, IRootServiceProvider, type ApplicationInitializationContext } from "@abp/core";
import { AbpCachingModule } from "@abp/caching";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { AbpDistributedLockingAbstractionsModule } from "@abp/distributed-locking";
import { AbpFeaturesModule, TenantFeatureValueProvider } from "@abp/features";
import { AbpExceptionLocalizationOptions } from "@abp/localization";
import { AbpFeatureManagementDomainSharedModule, AbpFeatureManagementResource } from "../domain-shared/index.js";
import { FeatureDynamicInitializer } from "./feature-dynamic-initializer.js";
import { FeatureManagementOptions } from "./feature-management-options.js";
import { ConfigurationFeatureManagementProvider, DefaultValueFeatureManagementProvider, EditionFeatureManagementProvider, TenantFeatureManagementProvider } from "./feature-management-provider.js";
import "./feature-value-cache-item.js";
import "./feature-management-store.js";
import "./feature-manager.js";
import "./feature-store.js";
import "./string-value-type-serializer.js";
import "./feature-definition-serializer.js";
import "./static-feature-saver.js";
import "./dynamic-feature-definition-store.js";

/**
 * Port of `AbpFeatureManagementDomainModule`. `AbpDddDomainModule` (entities, repositories) and the distributed
 * locking abstractions are explicit dependencies here; the `IsDataMigrationEnvironment` switch of .NET has no counterpart.
 */
@DependsOn(AbpFeatureManagementDomainSharedModule, AbpFeaturesModule, AbpCachingModule, AbpDddDomainModule, AbpDistributedLockingAbstractionsModule)
export class AbpFeatureManagementDomainModule extends AbpModule {
  private readonly abortController = new AbortController();

  override configureServices(): void {
    this.configure(FeatureManagementOptions, (options) => {
      options.providers.add(DefaultValueFeatureManagementProvider);
      options.providers.add(ConfigurationFeatureManagementProvider);
      options.providers.add(EditionFeatureManagementProvider);
      options.providers.add(TenantFeatureManagementProvider);
      options.providerPolicies.set(TenantFeatureValueProvider.ProviderName, "AbpTenantManagement.Tenants.ManageFeatures");
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("AbpFeatureManagement", AbpFeatureManagementResource);
    });
  }

  override async onPostApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    const rootServiceProvider = context.serviceProvider.getRequired(IRootServiceProvider);
    const options = rootServiceProvider.getOptions(FeatureManagementOptions);
    await rootServiceProvider.getRequired(FeatureDynamicInitializer).initialize(options.initializeInBackground, this.abortController.signal);
  }

  override onApplicationShutdown(): void {
    this.abortController.abort();
  }
}
