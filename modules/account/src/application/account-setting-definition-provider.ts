import { LocalizableString, Transient } from "@abp/core";
import { SettingDefinition, SettingDefinitionProvider, type ISettingDefinitionContext } from "@abp/settings";
import { AccountResource, AccountSettingNames } from "../application-contracts/index.js";

function L(name: string): LocalizableString {
  return LocalizableString.create(AccountResource, name);
}

/** Port of `AccountSettingDefinitionProvider`. */
@Transient()
export class AccountSettingDefinitionProvider extends SettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void {
    context.add(
      new SettingDefinition(AccountSettingNames.IsSelfRegistrationEnabled, "true", L("DisplayName:Abp.Account.IsSelfRegistrationEnabled"), L("Description:Abp.Account.IsSelfRegistrationEnabled"), true),
      new SettingDefinition(AccountSettingNames.EnableLocalLogin, "true", L("DisplayName:Abp.Account.EnableLocalLogin"), L("Description:Abp.Account.EnableLocalLogin"), true),
    );
  }
}
