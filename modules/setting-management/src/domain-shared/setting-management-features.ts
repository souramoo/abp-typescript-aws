import { LocalizableString, Transient } from "@abp/core";
import { FeatureDefinitionProvider, type IFeatureDefinitionContext } from "@abp/features";
import { ToggleStringValueType } from "@abp/validation";
import { AbpSettingManagementResource } from "./abp-setting-management-resource.js";

/** Port of `SettingManagementFeatures`. */
export const SettingManagementFeatures = {
  GroupName: "SettingManagement",
  Enable: "SettingManagement.Enable",
  AllowChangingEmailSettings: "SettingManagement.AllowChangingEmailSettings",
} as const;

function L(name: string): LocalizableString {
  return LocalizableString.create(AbpSettingManagementResource, name);
}

/** Port of `SettingManagementFeatureDefinitionProvider`. */
@Transient()
export class SettingManagementFeatureDefinitionProvider extends FeatureDefinitionProvider {
  define(context: IFeatureDefinitionContext): void {
    const group = context.addGroup(SettingManagementFeatures.GroupName, L("Feature:SettingManagementGroup"));

    const settingEnableFeature = group.addFeature(SettingManagementFeatures.Enable, {
      defaultValue: "true",
      displayName: L("Feature:SettingManagementEnable"),
      description: L("Feature:SettingManagementEnableDescription"),
      valueType: new ToggleStringValueType(),
      isAvailableToHost: false,
    });

    settingEnableFeature.createChild(SettingManagementFeatures.AllowChangingEmailSettings, {
      defaultValue: "false",
      displayName: L("Feature:AllowChangingEmailSettings"),
      valueType: new ToggleStringValueType(),
      isAvailableToHost: false,
    });
  }
}
