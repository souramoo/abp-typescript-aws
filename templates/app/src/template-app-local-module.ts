import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuditLoggingMemoryDbModule } from "@abp/audit-logging/memory-db";
import { AbpBackgroundJobsMemoryDbModule } from "@abp/background-jobs-store/memory-db";
import { AbpBlobStoringOptions } from "@abp/blob-storing";
import { AbpFeatureManagementMemoryDbModule } from "@abp/feature-management/memory-db";
import { AbpIdentityMemoryDbModule } from "@abp/identity/memory-db";
import { addMemoryDbContext } from "@abp/memory-db";
import { AbpPermissionManagementMemoryDbModule } from "@abp/permission-management/memory-db";
import { AbpSettingManagementMemoryDbModule } from "@abp/setting-management/memory-db";
import { AbpTenantManagementMemoryDbModule } from "@abp/tenant-management/memory-db";
import { TemplateAppMemoryDbContext } from "./books/index.js";
import { TemplateAppModule } from "./template-app-module.js";

/** The in-memory counterpart of `TemplateAppDynamoDbModule`: memory-db layers and the in-process providers. */
@DependsOn(
  TemplateAppModule,
  AbpIdentityMemoryDbModule,
  AbpPermissionManagementMemoryDbModule,
  AbpSettingManagementMemoryDbModule,
  AbpFeatureManagementMemoryDbModule,
  AbpTenantManagementMemoryDbModule,
  AbpAuditLoggingMemoryDbModule,
  AbpBackgroundJobsMemoryDbModule,
)
export class TemplateAppMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, TemplateAppMemoryDbContext, (options) => {
      options.addDefaultRepositories();
    });
    this.configure(AbpBlobStoringOptions, (options) => {
      options.containers.configureDefault((container) => {
        if (container.providerType === undefined) container.useMemory();
      });
    });
  }
}

/** The `pnpm dev` / test host (`App:Database` = `Memory`): everything in-process, worker timers as in .NET. */
@DependsOn(TemplateAppMemoryDbModule)
export class TemplateAppLocalModule extends AbpModule {}
