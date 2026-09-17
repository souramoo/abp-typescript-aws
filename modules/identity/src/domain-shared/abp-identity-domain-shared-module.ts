import { AbpModule, DependsOn } from "@abp/core";
import { AbpFeaturesModule } from "@abp/features";
import { AbpExceptionLocalizationOptions, AbpLocalizationOptions } from "@abp/localization";
import { AbpUsersDomainSharedModule } from "@abp/users/domain-shared";
import { AbpValidationModule, AbpValidationResource } from "@abp/validation";
import { IdentityResource, identityEn } from "./localization/identity-resource.js";

/** Port of `AbpIdentityDomainSharedModule` (the embedded JSON files become the `identityEn` object). */
@DependsOn(AbpUsersDomainSharedModule, AbpValidationModule, AbpFeaturesModule)
export class AbpIdentityDomainSharedModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(IdentityResource, "en").addBaseTypes(AbpValidationResource).addJson(identityEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.Abp.Identity", IdentityResource);
    });
  }
}
