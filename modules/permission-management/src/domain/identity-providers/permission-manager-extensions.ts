import { Check, type Guid } from "@abp/core";
import { ClientPermissionValueProvider, RolePermissionValueProvider, UserPermissionValueProvider } from "@abp/authorization";
import type { IPermissionManager, PermissionWithGrantedProviders } from "../permission-manager.js";

/* Port of `RolePermissionManagerExtensions`. */

export function getForRole(permissionManager: IPermissionManager, roleName: string, permissionName: string): Promise<PermissionWithGrantedProviders> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.get(permissionName, RolePermissionValueProvider.ProviderName, roleName);
}

export function getAllForRole(permissionManager: IPermissionManager, roleName: string): Promise<PermissionWithGrantedProviders[]> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.getAll(RolePermissionValueProvider.ProviderName, roleName);
}

export function setForRole(permissionManager: IPermissionManager, roleName: string, permissionName: string, isGranted: boolean): Promise<void> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.set(permissionName, RolePermissionValueProvider.ProviderName, roleName, isGranted);
}

/* Port of `UserPermissionManagerExtensions`. */

export function getAllForUser(permissionManager: IPermissionManager, userId: Guid): Promise<PermissionWithGrantedProviders[]> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.getAll(UserPermissionValueProvider.ProviderName, userId);
}

export function setForUser(permissionManager: IPermissionManager, userId: Guid, name: string, isGranted: boolean): Promise<void> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.set(name, UserPermissionValueProvider.ProviderName, userId, isGranted);
}

/* Port of `ClientPermissionManagerExtensions`. */

export function getForClient(permissionManager: IPermissionManager, clientId: string, permissionName: string): Promise<PermissionWithGrantedProviders> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.get(permissionName, ClientPermissionValueProvider.ProviderName, clientId);
}

export function getAllForClient(permissionManager: IPermissionManager, clientId: string): Promise<PermissionWithGrantedProviders[]> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.getAll(ClientPermissionValueProvider.ProviderName, clientId);
}

export function setForClient(permissionManager: IPermissionManager, clientId: string, permissionName: string, isGranted: boolean): Promise<void> {
  Check.notNull(permissionManager, "permissionManager");
  return permissionManager.set(permissionName, ClientPermissionValueProvider.ProviderName, clientId, isGranted);
}
