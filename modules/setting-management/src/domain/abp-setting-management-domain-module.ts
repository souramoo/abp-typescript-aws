import { AbpModule, DependsOn, IRootServiceProvider, type ApplicationInitializationContext } from "@abp/core";
import { AbpCachingModule } from "@abp/caching";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { AbpDistributedLockingAbstractionsModule } from "@abp/distributed-locking";
import { AbpSettingsModule } from "@abp/settings";
import { AbpSettingManagementDomainSharedModule } from "../domain-shared/index.js";
import { SettingDynamicInitializer } from "./setting-dynamic-initializer.js";
import { ConfigurationSettingManagementProvider, DefaultValueSettingManagementProvider, GlobalSettingManagementProvider, TenantSettingManagementProvider, UserSettingManagementProvider } from "./setting-management-provider.js";
import { SettingManagementOptions } from "./setting-management-options.js";
import "./setting-cache-item.js";
import "./setting-management-store.js";
import "./setting-manager.js";
import "./setting-store.js";
import "./setting-definition-serializer.js";
import "./static-setting-saver.js";
import "./dynamic-setting-definition-store.js";

/**
 * Port of `AbpSettingManagementDomainModule`. The distributed locking abstractions are an explicit dependency (the
 * saver and the dynamic store lock); the `IsDataMigrationEnvironment` switch of .NET has no counterpart.
 */
@DependsOn(AbpSettingsModule, AbpDddDomainModule, AbpSettingManagementDomainSharedModule, AbpCachingModule, AbpDistributedLockingAbstractionsModule)
export class AbpSettingManagementDomainModule extends AbpModule {
  private readonly abortController = new AbortController();

  override configureServices(): void {
    this.configure(SettingManagementOptions, (options) => {
      options.providers.add(DefaultValueSettingManagementProvider);
      options.providers.add(ConfigurationSettingManagementProvider);
      options.providers.add(GlobalSettingManagementProvider);
      options.providers.add(TenantSettingManagementProvider);
      options.providers.add(UserSettingManagementProvider);
    });
  }

  override async onPostApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    const rootServiceProvider = context.serviceProvider.getRequired(IRootServiceProvider);
    const options = rootServiceProvider.getOptions(SettingManagementOptions);
    await rootServiceProvider.getRequired(SettingDynamicInitializer).initialize(options.initializeInBackground, this.abortController.signal);
  }

  override onApplicationShutdown(): void {
    this.abortController.abort();
  }
}
