import { AbpModule, DependsOn } from "@abp/core";
import { AbpFeaturesModule } from "@abp/features";
import { AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationModule, AbpValidationResource } from "@abp/validation";
import { AbpSettingManagementResource, abpSettingManagementEn } from "./abp-setting-management-resource.js";
import "./setting-management-features.js";

/** Port of `AbpSettingManagementDomainSharedModule` (the virtual file system is replaced by the in-memory `en.json` object). */
@DependsOn(AbpLocalizationModule, AbpValidationModule, AbpFeaturesModule)
export class AbpSettingManagementDomainSharedModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpSettingManagementResource, "en").addBaseTypes(AbpValidationResource).addJson(abpSettingManagementEn);
    });
  }
}
