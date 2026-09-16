import { LocalizableString, Transient } from "@abp/core";
import { SettingDefinition, SettingDefinitionProvider, type ISettingDefinitionContext } from "@abp/settings";
import { EmailSettingNames } from "./email-setting-names.js";
import { EmailingResource } from "./emailing-resource.js";

function L(name: string): LocalizableString {
  return LocalizableString.create(EmailingResource, name);
}

/** Port of `EmailSettingProvider`: defines the settings used to send emails (see `EmailSettingNames`). */
@Transient()
export class EmailSettingProvider extends SettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void {
    context.add(
      new SettingDefinition(EmailSettingNames.Smtp.Host, "127.0.0.1", L("DisplayName:Abp.Mailing.Smtp.Host"), L("Description:Abp.Mailing.Smtp.Host")),
      new SettingDefinition(EmailSettingNames.Smtp.Port, "25", L("DisplayName:Abp.Mailing.Smtp.Port"), L("Description:Abp.Mailing.Smtp.Port")),
      new SettingDefinition(EmailSettingNames.Smtp.UserName, undefined, L("DisplayName:Abp.Mailing.Smtp.UserName"), L("Description:Abp.Mailing.Smtp.UserName")),
      new SettingDefinition(EmailSettingNames.Smtp.Password, undefined, L("DisplayName:Abp.Mailing.Smtp.Password"), L("Description:Abp.Mailing.Smtp.Password"), false, true, true),
      new SettingDefinition(EmailSettingNames.Smtp.Domain, undefined, L("DisplayName:Abp.Mailing.Smtp.Domain"), L("Description:Abp.Mailing.Smtp.Domain")),
      new SettingDefinition(EmailSettingNames.Smtp.EnableSsl, "false", L("DisplayName:Abp.Mailing.Smtp.EnableSsl"), L("Description:Abp.Mailing.Smtp.EnableSsl")),
      new SettingDefinition(EmailSettingNames.Smtp.UseDefaultCredentials, "true", L("DisplayName:Abp.Mailing.Smtp.UseDefaultCredentials"), L("Description:Abp.Mailing.Smtp.UseDefaultCredentials")),
      new SettingDefinition(EmailSettingNames.DefaultFromAddress, "noreply@abp.io", L("DisplayName:Abp.Mailing.DefaultFromAddress"), L("Description:Abp.Mailing.DefaultFromAddress")),
      new SettingDefinition(EmailSettingNames.DefaultFromDisplayName, "ABP application", L("DisplayName:Abp.Mailing.DefaultFromDisplayName"), L("Description:Abp.Mailing.DefaultFromDisplayName")),
    );
  }
}
