import { Transient, localizableString, type LocalizableString } from "@abp/core";
import { PermissionDefinitionProvider, type IPermissionDefinitionContext } from "@abp/authorization";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { AbpTenantManagementResource } from "../domain-shared/index.js";
import { TenantManagementPermissions } from "./tenant-management-permissions.js";

/** Port of `AbpTenantManagementPermissionDefinitionProvider`. */
@Transient()
export class AbpTenantManagementPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const tenantManagementGroup = context.addGroup(TenantManagementPermissions.GroupName, L("Permission:TenantManagement"));

    const tenantsPermission = tenantManagementGroup.addPermission(TenantManagementPermissions.Tenants.Default, L("Permission:TenantManagement"), MultiTenancySides.Host);
    tenantsPermission.addChild(TenantManagementPermissions.Tenants.Create, L("Permission:Create"), MultiTenancySides.Host);
    tenantsPermission.addChild(TenantManagementPermissions.Tenants.Update, L("Permission:Edit"), MultiTenancySides.Host);
    tenantsPermission.addChild(TenantManagementPermissions.Tenants.Delete, L("Permission:Delete"), MultiTenancySides.Host);
    tenantsPermission.addChild(TenantManagementPermissions.Tenants.ManageFeatures, L("Permission:ManageFeatures"), MultiTenancySides.Host);
    tenantsPermission.addChild(TenantManagementPermissions.Tenants.ManageConnectionStrings, L("Permission:ManageConnectionStrings"), MultiTenancySides.Host);
  }
}

function L(name: string): LocalizableString {
  return localizableString(AbpTenantManagementResource, name);
}
