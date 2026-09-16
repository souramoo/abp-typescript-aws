import { AbpModule, DependsOn } from "@abp/core";
import { AbpCachingModule } from "@abp/caching";
import { AbpDataModule } from "@abp/data";
import { AbpDddDomainModule, AbpDistributedEntityEventOptions } from "@abp/ddd-domain";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpObjectMappingModule, AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpTenantManagementDomainSharedModule, TenantEto } from "../domain-shared/index.js";
import { Tenant } from "./tenant.js";
import { TenantManagementDomainMappingProfile } from "./tenant-management-domain-mapping-profile.js";
import "./tenant-manager.js";
import "./tenant-validator.js";

/**
 * Port of `AbpTenantManagementDomainModule`. `AbpMapperlyModule` becomes the object-mapping profile registered under
 * this module class (the `IObjectMapper<AbpTenantManagementDomainModule>` context); the object-extension
 * configuration step (`ModuleExtensionConfigurationHelper`) has no counterpart in this port.
 */
@DependsOn(AbpMultiTenancyModule, AbpTenantManagementDomainSharedModule, AbpDataModule, AbpDddDomainModule, AbpObjectMappingModule, AbpCachingModule)
export class AbpTenantManagementDomainModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(TenantManagementDomainMappingProfile, AbpTenantManagementDomainModule);
    });

    this.configure(AbpDistributedEntityEventOptions, (options) => {
      options.etoMappings.add(Tenant, TenantEto, AbpTenantManagementDomainModule);
    });
  }
}
