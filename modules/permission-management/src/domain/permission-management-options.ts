import { TypeList } from "@abp/core";
import type { IPermissionManagementProvider } from "./permission-management-provider.js";

/**
 * Port of `PermissionManagementOptions`. The resource-permission lists (`ResourceManagementProviders`,
 * `ResourcePermissionProviderKeyLookupServices`) are not ported: resource permissions are out of scope of this port.
 */
export class PermissionManagementOptions {
  readonly managementProviders = new TypeList<IPermissionManagementProvider>();
  /** Provider name → the authorization policy required to get/set permissions of that provider. */
  readonly providerPolicies = new Map<string, string>();
  /** Default: true. */
  saveStaticPermissionsToDatabase = true;
  /** Default: false. */
  isDynamicPermissionStoreEnabled = false;
}
