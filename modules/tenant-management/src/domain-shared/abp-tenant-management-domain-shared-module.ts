import { AbpModule, DependsOn } from "@abp/core";
import { AbpExceptionLocalizationOptions, AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationModule, AbpValidationResource } from "@abp/validation";
import { AbpTenantManagementResource, abpTenantManagementEn } from "./localization.js";

/** Port of `AbpTenantManagementDomainSharedModule` (the virtual file system is replaced by the inlined `en.json`). */
@DependsOn(AbpValidationModule)
export class AbpTenantManagementDomainSharedModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpTenantManagementResource, "en").addBaseTypes(AbpValidationResource).addJson(abpTenantManagementEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.Abp.TenantManagement", AbpTenantManagementResource);
    });
  }
}
