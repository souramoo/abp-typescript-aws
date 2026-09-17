import { LocalizableString, Transient } from "@abp/core";
import { ClientPermissionValueProvider, PermissionDefinitionProvider, type IPermissionDefinitionContext } from "@abp/authorization";
import { IdentityResource } from "../domain-shared/index.js";

/** Port of `IdentityPermissions`. */
export const IdentityPermissions = {
  GroupName: "AbpIdentity",
  Roles: {
    Default: "AbpIdentity.Roles",
    Create: "AbpIdentity.Roles.Create",
    Update: "AbpIdentity.Roles.Update",
    Delete: "AbpIdentity.Roles.Delete",
    ManagePermissions: "AbpIdentity.Roles.ManagePermissions",
  },
  Users: {
    Default: "AbpIdentity.Users",
    Create: "AbpIdentity.Users.Create",
    Update: "AbpIdentity.Users.Update",
    Delete: "AbpIdentity.Users.Delete",
    ManagePermissions: "AbpIdentity.Users.ManagePermissions",
    ManageRoles: "AbpIdentity.Users.Update.ManageRoles",
  },
  UserLookup: {
    Default: "AbpIdentity.UserLookup",
  },
  /** Port of `GetAll()` (`ReflectionHelper.GetPublicConstantsRecursively`). */
  getAll(): string[] {
    return [...Object.values(IdentityPermissions.Roles), ...Object.values(IdentityPermissions.Users), ...Object.values(IdentityPermissions.UserLookup)];
  },
} as const;

function L(name: string): LocalizableString {
  return LocalizableString.create(IdentityResource, name);
}

/** Port of `IdentityPermissionDefinitionProvider`. */
@Transient()
export class IdentityPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const identityGroup = context.addGroup(IdentityPermissions.GroupName, L("Permission:IdentityManagement"));

    const rolesPermission = identityGroup.addPermission(IdentityPermissions.Roles.Default, L("Permission:RoleManagement"));
    rolesPermission.addChild(IdentityPermissions.Roles.Create, L("Permission:Create"));
    rolesPermission.addChild(IdentityPermissions.Roles.Update, L("Permission:Edit"));
    rolesPermission.addChild(IdentityPermissions.Roles.Delete, L("Permission:Delete"));
    rolesPermission.addChild(IdentityPermissions.Roles.ManagePermissions, L("Permission:ChangePermissions"));

    const usersPermission = identityGroup.addPermission(IdentityPermissions.Users.Default, L("Permission:UserManagement"));
    usersPermission.addChild(IdentityPermissions.Users.Create, L("Permission:Create"));
    const editPermission = usersPermission.addChild(IdentityPermissions.Users.Update, L("Permission:Edit"));
    editPermission.addChild(IdentityPermissions.Users.ManageRoles, L("Permission:ManageRoles"));
    usersPermission.addChild(IdentityPermissions.Users.Delete, L("Permission:Delete"));
    usersPermission.addChild(IdentityPermissions.Users.ManagePermissions, L("Permission:ChangePermissions"));

    identityGroup.addPermission(IdentityPermissions.UserLookup.Default, L("Permission:UserLookup")).withProviders(ClientPermissionValueProvider.ProviderName);
  }
}
