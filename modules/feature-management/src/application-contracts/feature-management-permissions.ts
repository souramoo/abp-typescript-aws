import { LocalizableString, Transient } from "@abp/core";
import { PermissionDefinitionProvider, type IPermissionDefinitionContext } from "@abp/authorization";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { AbpFeatureManagementResource } from "../domain-shared/index.js";

/** Port of `FeatureManagementPermissions`. */
export const FeatureManagementPermissions = {
  GroupName: "FeatureManagement",
  ManageHostFeatures: "FeatureManagement.ManageHostFeatures",
  getAll(): string[] {
    return [FeatureManagementPermissions.GroupName, FeatureManagementPermissions.ManageHostFeatures];
  },
} as const;

function L(name: string): LocalizableString {
  return LocalizableString.create(AbpFeatureManagementResource, name);
}

/** Port of `FeaturePermissionDefinitionProvider`. */
@Transient()
export class FeaturePermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const featureManagementGroup = context.addGroup(FeatureManagementPermissions.GroupName, L("Permission:FeatureManagement"));
    featureManagementGroup.addPermission(FeatureManagementPermissions.ManageHostFeatures, L("Permission:FeatureManagement.ManageHostFeatures"), MultiTenancySides.Host);
  }
}
