import { AbpModule, DependsOn } from "@abp/core";
import { AbpDddApplicationModule } from "@abp/ddd-application";
import { AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpTenantManagementApplicationContractsModule } from "../application-contracts/index.js";
import { AbpTenantManagementDomainModule } from "../domain/index.js";
import { TenantManagementApplicationMappingProfile } from "./tenant-management-application-mapping-profile.js";

/** Port of `AbpTenantManagementApplicationModule` (`AddMapperlyObjectMapper<T>` becomes a profile bound to this module class). */
@DependsOn(AbpTenantManagementDomainModule, AbpTenantManagementApplicationContractsModule, AbpDddApplicationModule)
export class AbpTenantManagementApplicationModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(TenantManagementApplicationMappingProfile, AbpTenantManagementApplicationModule);
    });
  }
}
