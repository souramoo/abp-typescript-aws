import { AbpModule, DependsOn } from "@abp/core";
import { AbpEmailingModule } from "@abp/emailing";
import { AbpIdentityApplicationModule, IdentityApplicationMappingProfile } from "@abp/identity/application";
import { AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpTextTemplatingOptions } from "@abp/text-templating";
import { AbpAccountApplicationContractsModule } from "../application-contracts/index.js";
import { AccountApplicationMappingProfile } from "./account-application-mapping-profile.js";
import { AccountEmailTemplates, AppUrlOptions, AccountUrlNames, PasswordResetLinkTemplate } from "./account-emailer.js";
import "./account-emailer.js";
import "./account-setting-definition-provider.js";
import "./account-app-service.js";
import "./profile-app-service.js";
import "./dynamic-claims-app-service.js";

/**
 * Port of `AbpAccountApplicationModule`. `AddMapperlyObjectMapper<AbpAccountApplicationModule>` becomes the mapping
 * profiles bound to this module as context; the embedded `PasswordResetLink.tpl` is registered as in-memory content.
 */
@DependsOn(AbpAccountApplicationContractsModule, AbpIdentityApplicationModule, AbpEmailingModule)
export class AbpAccountApplicationModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(IdentityApplicationMappingProfile, AbpAccountApplicationModule);
      options.addProfile(AccountApplicationMappingProfile, AbpAccountApplicationModule);
    });

    this.configure(AbpTextTemplatingOptions, (options) => {
      options.contents.add(AccountEmailTemplates.PasswordResetLink, undefined, PasswordResetLinkTemplate);
    });

    this.configure(AppUrlOptions, (options) => {
      options.setUrl("MVC", AccountUrlNames.PasswordReset, "Account/ResetPassword");
    });
  }
}
