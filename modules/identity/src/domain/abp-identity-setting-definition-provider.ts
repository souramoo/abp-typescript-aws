import { LocalizableString, Transient } from "@abp/core";
import { SettingDefinition, SettingDefinitionProvider, type ISettingDefinitionContext } from "@abp/settings";
import { IdentityResource, IdentitySettingNames } from "../domain-shared/index.js";

function L(name: string): LocalizableString {
  return LocalizableString.create(IdentityResource, name);
}

function setting(name: string, defaultValue: string, displayNameKey = `DisplayName:${name}`, descriptionKey = `Description:${name}`): SettingDefinition {
  return new SettingDefinition(name, defaultValue, L(displayNameKey), L(descriptionKey), true);
}

/** Port of `AbpIdentitySettingDefinitionProvider` (same names and defaults as .NET). */
@Transient()
export class AbpIdentitySettingDefinitionProvider extends SettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void {
    context.add(
      setting(IdentitySettingNames.Password.RequiredLength, "6"),
      setting(IdentitySettingNames.Password.RequiredUniqueChars, "1"),
      setting(IdentitySettingNames.Password.RequireNonAlphanumeric, "True"),
      setting(IdentitySettingNames.Password.RequireLowercase, "True"),
      setting(IdentitySettingNames.Password.RequireUppercase, "True"),
      setting(IdentitySettingNames.Password.RequireDigit, "True"),
      setting(IdentitySettingNames.Password.ForceUsersToPeriodicallyChangePassword, "False"),
      setting(IdentitySettingNames.Password.PasswordChangePeriodDays, "0"),
      setting(IdentitySettingNames.Password.EnablePreventPasswordReuse, "False"),
      setting(IdentitySettingNames.Password.PreventPasswordReuseCount, "6"),
      setting(IdentitySettingNames.Lockout.AllowedForNewUsers, "True"),
      setting(IdentitySettingNames.Lockout.LockoutDuration, String(5 * 60)),
      setting(IdentitySettingNames.Lockout.MaxFailedAccessAttempts, "5"),
      setting(IdentitySettingNames.SignIn.RequireConfirmedEmail, "False"),
      setting(IdentitySettingNames.SignIn.EnablePhoneNumberConfirmation, "True"),
      setting(IdentitySettingNames.SignIn.RequireEmailVerificationToRegister, "False"),
      setting(IdentitySettingNames.SignIn.RequireConfirmedPhoneNumber, "False"),
      setting(IdentitySettingNames.User.IsUserNameUpdateEnabled, "True"),
      setting(IdentitySettingNames.User.IsEmailUpdateEnabled, "True"),
      setting(IdentitySettingNames.OrganizationUnit.MaxUserMembershipCount, String(2147483647), "Identity.OrganizationUnit.MaxUserMembershipCount", "Identity.OrganizationUnit.MaxUserMembershipCount"),
    );
  }
}
