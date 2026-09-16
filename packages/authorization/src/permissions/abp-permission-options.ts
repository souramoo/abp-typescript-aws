import { TypeList } from "@abp/core";
import type { IPermissionDefinitionProvider } from "./permission-definition-provider.js";
import type { IPermissionValueProvider } from "./permission-value-provider.js";
import type { IResourcePermissionValueProvider } from "./resources/resource-permissions.js";

/** Port of `AbpPermissionOptions`. */
export class AbpPermissionOptions {
  readonly definitionProviders = new TypeList<IPermissionDefinitionProvider>();
  readonly valueProviders = new TypeList<IPermissionValueProvider>();
  readonly resourceValueProviders = new TypeList<IResourcePermissionValueProvider>();
  readonly deletedPermissions = new Set<string>();
  readonly deletedPermissionGroups = new Set<string>();
}
