import { AbpModule, DependsOn } from "@abp/core";
import { AbpJsonModule } from "@abp/json";
import { AbpExceptionLocalizationOptions, AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationModule, AbpValidationResource } from "@abp/validation";
import { AbpFeatureManagementResource, abpFeatureManagementEn } from "./abp-feature-management-resource.js";

/**
 * Port of `AbpFeatureManagementDomainSharedModule`. The System.Text.Json converters become the
 * `stringValueTypeToJson`/`stringValueTypeFromJson` functions used by the serializer and the DTOs.
 */
@DependsOn(AbpValidationModule, AbpJsonModule, AbpLocalizationModule)
export class AbpFeatureManagementDomainSharedModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpFeatureManagementResource, "en").addBaseTypes(AbpValidationResource).addJson(abpFeatureManagementEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.Abp.FeatureManagement", AbpFeatureManagementResource);
    });
  }
}
