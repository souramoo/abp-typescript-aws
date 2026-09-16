import { AbpException, Check, type ILocalizableString, type IServiceProvider } from "@abp/core";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { PermissionDefinition, PermissionDefinitionKnownPropertyNames, PermissionGroupDefinition } from "./permission-definition.js";
import type { IPermissionDefinitionProvider } from "./permission-definition-provider.js";

/** Port of `IPermissionDefinitionContext`. */
export interface IPermissionDefinitionContext {
  readonly serviceProvider: IServiceProvider;
  getGroup(name: string): PermissionGroupDefinition;
  getGroupOrNull(name: string): PermissionGroupDefinition | undefined;
  addGroup(name: string, displayName?: ILocalizableString): PermissionGroupDefinition;
  removeGroup(name: string): void;
  getPermissionOrNull(name: string): PermissionDefinition | undefined;
  addResourcePermission(name: string, resourceName: string, managementPermissionName: string, displayName?: ILocalizableString, multiTenancySide?: MultiTenancySides, isEnabled?: boolean): PermissionDefinition;
  getResourcePermissionOrNull(resourceName: string, name: string): PermissionDefinition | undefined;
  removeResourcePermission(resourceName: string, name: string): void;
}

/** Port of `PermissionDefinitionContext`. */
export class PermissionDefinitionContext implements IPermissionDefinitionContext {
  static readonly KnownPropertyNames = PermissionDefinitionKnownPropertyNames;
  readonly groups = new Map<string, PermissionGroupDefinition>();
  readonly resourcePermissions: PermissionDefinition[] = [];
  currentProvider: IPermissionDefinitionProvider | undefined;

  constructor(readonly serviceProvider: IServiceProvider) {}

  addGroup(name: string, displayName?: ILocalizableString): PermissionGroupDefinition {
    Check.notNull(name, "name");
    if (this.groups.has(name)) throw new AbpException(`There is already an existing permission group with name: ${name}`);
    const group = new PermissionGroupDefinition(name, displayName);
    if (this.currentProvider) group.properties.set(PermissionDefinitionKnownPropertyNames.CurrentProviderName, this.currentProvider.constructor.name);
    this.groups.set(name, group);
    return group;
  }

  getGroup(name: string): PermissionGroupDefinition {
    const group = this.getGroupOrNull(name);
    if (!group) throw new AbpException(`Could not find a permission definition group with the given name: ${name}`);
    return group;
  }

  getGroupOrNull(name: string): PermissionGroupDefinition | undefined {
    Check.notNull(name, "name");
    return this.groups.get(name);
  }

  removeGroup(name: string): void {
    Check.notNull(name, "name");
    if (!this.groups.delete(name)) throw new AbpException(`Not found permission group with name: ${name}`);
  }

  getPermissionOrNull(name: string): PermissionDefinition | undefined {
    Check.notNull(name, "name");
    for (const group of this.groups.values()) {
      const permission = group.getPermissionOrNull(name);
      if (permission) return permission;
    }
    return undefined;
  }

  addResourcePermission(name: string, resourceName: string, managementPermissionName: string, displayName?: ILocalizableString, multiTenancySide: MultiTenancySides = MultiTenancySides.Both, isEnabled = true): PermissionDefinition {
    Check.notNull(name, "name");
    Check.notNull(resourceName, "resourceName");
    Check.notNull(managementPermissionName, "managementPermissionName");
    if (this.getResourcePermissionOrNull(resourceName, name)) {
      throw new AbpException(`There is already an existing resource permission with name: ${name} for resource: ${resourceName}`);
    }
    const permission = new PermissionDefinition(name, displayName, multiTenancySide, isEnabled, { resourceName, managementPermissionName });
    permission.properties.set(PermissionDefinitionKnownPropertyNames.CurrentProviderName, this.currentProvider?.constructor.name);
    this.resourcePermissions.push(permission);
    return permission;
  }

  getResourcePermissionOrNull(resourceName: string, name: string): PermissionDefinition | undefined {
    Check.notNull(resourceName, "resourceName");
    Check.notNull(name, "name");
    return this.resourcePermissions.find((p) => p.resourceName === resourceName && p.name === name);
  }

  removeResourcePermission(resourceName: string, name: string): void {
    const permission = this.getResourcePermissionOrNull(resourceName, name);
    if (!permission) throw new AbpException(`Not found resource permission with name: ${name} for resource: ${resourceName}`);
    this.resourcePermissions.splice(this.resourcePermissions.indexOf(permission), 1);
  }
}

/** Port of `PermissionDefinitionContextExtensions.TryDisablePermission`. */
export function tryDisablePermission(context: IPermissionDefinitionContext, name: string): boolean {
  const permission = context.getPermissionOrNull(Check.notNull(name, "name"));
  if (!permission) return false;
  permission.isEnabled = false;
  return true;
}
