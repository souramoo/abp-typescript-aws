import { AbpModule, DependsOn, type ApplicationInitializationContext, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuthorizationModule } from "@abp/authorization";
import { AbpCachingModule } from "@abp/caching";
import { isDataMigrationEnvironment } from "@abp/data";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { AbpDistributedLockingAbstractionsModule } from "@abp/distributed-locking";
import { AbpJsonModule } from "@abp/json";
import { AbpPermissionManagementDomainSharedModule } from "../domain-shared/index.js";
import { PermissionDynamicInitializer } from "./permission-dynamic-initializer.js";
import { PermissionManagementOptions } from "./permission-management-options.js";
import "./permission-grant-cache-item.js";
import "./permission-manager.js";
import "./permission-store.js";
import "./permission-data-seeder.js";
import "./permission-definition-serializer.js";
import "./dynamic-permission-definition-store.js";
import "./static-permission-saver.js";
import "./permission-finder.js";

/**
 * Port of `AbpPermissionManagementDomainModule`. The static permission save / dynamic pre-cache runs inline in
 * `onPostApplicationInitialization` (the .NET module starts it in the background on `OnApplicationInitialization`).
 * `AbpDistributedLockingAbstractionsModule` is an explicit dependency here (a package reference in .NET).
 */
@DependsOn(AbpAuthorizationModule, AbpDddDomainModule, AbpPermissionManagementDomainSharedModule, AbpCachingModule, AbpJsonModule, AbpDistributedLockingAbstractionsModule)
export class AbpPermissionManagementDomainModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    if (isDataMigrationEnvironment(context.services)) {
      this.configure(PermissionManagementOptions, (options) => {
        options.saveStaticPermissionsToDatabase = false;
        options.isDynamicPermissionStoreEnabled = false;
      });
    }
  }

  override async onPostApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    if (isDataMigrationEnvironment(context.serviceProvider)) return;
    await context.serviceProvider.getRequired(PermissionDynamicInitializer).initialize();
  }
}
