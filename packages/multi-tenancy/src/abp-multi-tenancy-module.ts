import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpDataModule } from "@abp/data";
import { AbpDefaultTenantStoreOptions, AbpMultiTenancyAbstractionsModule, AbpTenantResolveOptions } from "@abp/multi-tenancy-abstractions";
import { AbpSecurityModule } from "@abp/security";
import { AbpUnitOfWorkModule } from "@abp/uow";
import { bindTenantsFromConfiguration } from "./default-tenant-store.js";
import { CurrentUserTenantResolveContributor } from "./tenant-resolver.js";

/** Port of `AbpMultiTenancyModule` (settings/event-bus integrations live in their own packages). */
@DependsOn(AbpMultiTenancyAbstractionsModule, AbpDataModule, AbpSecurityModule, AbpUnitOfWorkModule)
export class AbpMultiTenancyModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    if (configuration) {
      this.configure(AbpDefaultTenantStoreOptions, (options) => {
        options.tenants.push(...bindTenantsFromConfiguration(configuration));
      });
    }

    this.configure(AbpTenantResolveOptions, (options) => {
      options.tenantResolvers.unshift(new CurrentUserTenantResolveContributor());
    });
  }
}
