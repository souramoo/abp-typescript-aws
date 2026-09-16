import { AbpModule, DependsOn } from "@abp/core";
import { AbpLocalizationModule } from "@abp/localization";
import { AbpValidationModule, AbpValidationOptions } from "@abp/validation";
import { ExtensibleObjectValidator } from "./extensible-object-validator.js";

/** Port of `AbpObjectExtendingModule`; additionally registers the extra-property validation contributor. */
@DependsOn(AbpLocalizationModule, AbpValidationModule)
export class AbpObjectExtendingModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpValidationOptions, (options) => {
      options.objectValidationContributors.add(ExtensibleObjectValidator);
    });
  }
}
