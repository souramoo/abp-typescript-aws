import { AbpModule, DependsOn } from "@abp/core";
import { AbpIdentityApplicationContractsModule } from "@abp/identity/application-contracts";
import { AbpExceptionLocalizationOptions, AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationResource } from "@abp/validation";
import { AccountResource, accountEn } from "./localization/account-resource.js";

/** Port of `AbpAccountApplicationContractsModule` (the embedded JSON files become the `accountEn` object). */
@DependsOn(AbpIdentityApplicationContractsModule)
export class AbpAccountApplicationContractsModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AccountResource, "en").addBaseTypes(AbpValidationResource).addJson(accountEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.Account", AccountResource);
    });
  }
}
