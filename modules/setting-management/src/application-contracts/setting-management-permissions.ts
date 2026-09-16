import { LocalizableString, Transient, type SimpleStateCheckerContext, type ISimpleStateChecker } from "@abp/core";
import { PermissionDefinitionProvider, type IPermissionDefinitionContext, type PermissionDefinition } from "@abp/authorization";
import { IFeatureChecker } from "@abp/features";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpSettingManagementResource, SettingManagementFeatures } from "../domain-shared/index.js";

/** Port of `SettingManagementPermissions`. */
export const SettingManagementPermissions = {
  GroupName: "SettingManagement",
  Emailing: "SettingManagement.Emailing",
  EmailingTest: "SettingManagement.Emailing.Test",
  TimeZone: "SettingManagement.TimeZone",
  getAll(): string[] {
    return [SettingManagementPermissions.GroupName, SettingManagementPermissions.Emailing, SettingManagementPermissions.EmailingTest, SettingManagementPermissions.TimeZone];
  },
} as const;

/** Port of `AllowChangingEmailSettingsFeatureSimpleStateChecker`: tenants see the emailing permission only with the feature enabled. */
export class AllowChangingEmailSettingsFeatureSimpleStateChecker implements ISimpleStateChecker<PermissionDefinition> {
  async isEnabled(context: SimpleStateCheckerContext<PermissionDefinition>): Promise<boolean> {
    const currentTenant = context.serviceProvider.getRequired(ICurrentTenant);
    if (!currentTenant.isAvailable) return true;
    return context.serviceProvider.getRequired(IFeatureChecker).isEnabled(SettingManagementFeatures.AllowChangingEmailSettings);
  }
}

function L(name: string): LocalizableString {
  return LocalizableString.create(AbpSettingManagementResource, name);
}

/** Port of `SettingManagementPermissionDefinitionProvider`. */
@Transient()
export class SettingManagementPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const moduleGroup = context.addGroup(SettingManagementPermissions.GroupName, L("Permission:SettingManagement"));

    const emailPermission = moduleGroup.addPermission(SettingManagementPermissions.Emailing, L("Permission:Emailing"));
    emailPermission.stateCheckers.push(new AllowChangingEmailSettingsFeatureSimpleStateChecker());
    emailPermission.addChild(SettingManagementPermissions.EmailingTest, L("Permission:EmailingTest"));

    moduleGroup.addPermission(SettingManagementPermissions.TimeZone, L("Permission:TimeZone"));
  }
}
