import { AbpException, Check, FixedLocalizableString, addIfNotContains, type IHasSimpleStateCheckers, type ILocalizableString, type ISimpleStateChecker } from "@abp/core";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";

/** Port of `PermissionDefinitionContext.KnownPropertyNames`. */
export const PermissionDefinitionKnownPropertyNames = {
  CurrentProviderName: "_CurrentProviderName",
} as const;

/** Port of `ICanAddChildPermission`. */
export interface ICanAddChildPermission {
  addPermission(name: string, displayName?: ILocalizableString, multiTenancySide?: MultiTenancySides, isEnabled?: boolean): PermissionDefinition;
}

export interface ResourcePermissionInfo {
  readonly resourceName: string;
  readonly managementPermissionName: string;
}

/** Port of `PermissionDefinition`. The `this[name]` indexer becomes `properties.get/set`. */
export class PermissionDefinition implements IHasSimpleStateCheckers<PermissionDefinition>, ICanAddChildPermission {
  readonly name: string;
  resourceName: string | undefined;
  managementPermissionName: string | undefined;
  private parentDefinition: PermissionDefinition | undefined;
  multiTenancySide: MultiTenancySides;
  readonly providers: string[] = [];
  readonly stateCheckers: ISimpleStateChecker<PermissionDefinition>[] = [];
  private displayNameValue!: ILocalizableString;
  private readonly childList: PermissionDefinition[] = [];
  readonly properties = new Map<string, unknown>();
  isEnabled: boolean;

  constructor(name: string, displayName?: ILocalizableString, multiTenancySide: MultiTenancySides = MultiTenancySides.Both, isEnabled = true, resource?: ResourcePermissionInfo) {
    this.name = Check.notNull(name, "name");
    this.displayName = displayName ?? new FixedLocalizableString(name);
    this.multiTenancySide = multiTenancySide;
    this.isEnabled = isEnabled;
    if (resource) {
      this.resourceName = Check.notNull(resource.resourceName, "resourceName");
      this.managementPermissionName = Check.notNull(resource.managementPermissionName, "managementPermissionName");
    }
  }

  get displayName(): ILocalizableString {
    return this.displayNameValue;
  }
  set displayName(value: ILocalizableString) {
    this.displayNameValue = Check.notNull(value, "value");
  }

  /** Parent of this permission if one exists. If set, this permission can be granted only if parent is granted. */
  get parent(): PermissionDefinition | undefined {
    return this.parentDefinition;
  }

  get children(): readonly PermissionDefinition[] {
    return [...this.childList];
  }

  addChild(name: string, displayName?: ILocalizableString, multiTenancySide: MultiTenancySides = MultiTenancySides.Both, isEnabled = true): PermissionDefinition {
    if (this.resourceName !== undefined) throw new AbpException(`Resource permission cannot have child permissions. Resource: ${this.resourceName}`);
    const child = new PermissionDefinition(name, displayName, multiTenancySide, isEnabled);
    child.parentDefinition = this;
    child.properties.set(PermissionDefinitionKnownPropertyNames.CurrentProviderName, this.properties.get(PermissionDefinitionKnownPropertyNames.CurrentProviderName));
    this.childList.push(child);
    return child;
  }

  addPermission(name: string, displayName?: ILocalizableString, multiTenancySide?: MultiTenancySides, isEnabled?: boolean): PermissionDefinition {
    return this.addChild(name, displayName, multiTenancySide, isEnabled);
  }

  withProperty(key: string, value: unknown): this {
    this.properties.set(key, value);
    return this;
  }

  withProviders(...providers: string[]): this {
    addIfNotContains(this.providers, ...providers);
    return this;
  }

  toString(): string {
    return `[PermissionDefinition ${this.name}]`;
  }
}

/** Port of `PermissionGroupDefinition`. */
export class PermissionGroupDefinition implements ICanAddChildPermission {
  readonly properties = new Map<string, unknown>();
  private displayNameValue!: ILocalizableString;
  private readonly permissionList: PermissionDefinition[] = [];

  constructor(
    readonly name: string,
    displayName?: ILocalizableString,
  ) {
    this.displayName = displayName ?? new FixedLocalizableString(name);
  }

  get displayName(): ILocalizableString {
    return this.displayNameValue;
  }
  set displayName(value: ILocalizableString) {
    this.displayNameValue = Check.notNull(value, "value");
  }

  get permissions(): readonly PermissionDefinition[] {
    return [...this.permissionList];
  }

  addPermission(name: string, displayName?: ILocalizableString, multiTenancySide: MultiTenancySides = MultiTenancySides.Both, isEnabled = true): PermissionDefinition {
    const permission = new PermissionDefinition(name, displayName, multiTenancySide, isEnabled);
    permission.properties.set(PermissionDefinitionKnownPropertyNames.CurrentProviderName, this.properties.get(PermissionDefinitionKnownPropertyNames.CurrentProviderName));
    this.permissionList.push(permission);
    return permission;
  }

  getPermissionsWithChildren(): PermissionDefinition[] {
    const permissions: PermissionDefinition[] = [];
    for (const permission of this.permissionList) addPermissionRecursively(permissions, permission);
    return permissions;
  }

  getPermissionOrNull(name: string): PermissionDefinition | undefined {
    Check.notNull(name, "name");
    return findPermissionRecursively(this.permissionList, name);
  }

  toString(): string {
    return `[PermissionGroupDefinition ${this.name}]`;
  }
}

function addPermissionRecursively(into: PermissionDefinition[], permission: PermissionDefinition): void {
  into.push(permission);
  for (const child of permission.children) addPermissionRecursively(into, child);
}

function findPermissionRecursively(permissions: readonly PermissionDefinition[], name: string): PermissionDefinition | undefined {
  for (const permission of permissions) {
    if (permission.name === name) return permission;
    const child = findPermissionRecursively(permission.children, name);
    if (child) return child;
  }
  return undefined;
}
