import { AbpModule, DependsOn } from "@abp/core";
import { AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationModule, AbpValidationResource } from "@abp/validation";
import { AbpPermissionManagementResource, abpPermissionManagementEn } from "./localization/abp-permission-management-resource.js";

/** Port of `AbpPermissionManagementDomainSharedModule` (the embedded JSON files become the `abpPermissionManagementEn` object). */
@DependsOn(AbpValidationModule)
export class AbpPermissionManagementDomainSharedModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpPermissionManagementResource, "en").addBaseTypes(AbpValidationResource).addJson(abpPermissionManagementEn);
    });
  }
}
