import { AbpException, Check, IServiceProviderToken, Singleton, Transient, createToken, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpPermissionOptions } from "./abp-permission-options.js";
import type { PermissionDefinition, PermissionGroupDefinition } from "./permission-definition.js";
import { PermissionDefinitionContext } from "./permission-definition-context.js";

/** Port of `IStaticPermissionDefinitionStore`. */
export interface IStaticPermissionDefinitionStore {
  getOrNull(name: string): Promise<PermissionDefinition | undefined>;
  getPermissions(): Promise<readonly PermissionDefinition[]>;
  getResourcePermissionOrNull(resourceName: string, name: string): Promise<PermissionDefinition | undefined>;
  getResourcePermissions(): Promise<readonly PermissionDefinition[]>;
  getGroups(): Promise<readonly PermissionGroupDefinition[]>;
}
export const IStaticPermissionDefinitionStore = createToken<IStaticPermissionDefinitionStore>("IStaticPermissionDefinitionStore");

/** Port of `IDynamicPermissionDefinitionStore`. */
export type IDynamicPermissionDefinitionStore = IStaticPermissionDefinitionStore;
export const IDynamicPermissionDefinitionStore = createToken<IDynamicPermissionDefinitionStore>("IDynamicPermissionDefinitionStore");

interface GroupDefinitions {
  readonly groups: Map<string, PermissionGroupDefinition>;
  readonly resourcePermissions: PermissionDefinition[];
}

/**
 * Port of `StaticPermissionDefinitionStore`. `IStaticDefinitionCache` does not exist in this port; definitions are
 * built once per store instance (singleton) from `AbpPermissionOptions.definitionProviders` on first use.
 */
@Singleton(IStaticPermissionDefinitionStore)
export class StaticPermissionDefinitionStore implements IStaticPermissionDefinitionStore {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpPermissionOptions)] as const;
  protected readonly options: AbpPermissionOptions;
  private groupDefinitions: Promise<GroupDefinitions> | undefined;
  private permissionDefinitions: Promise<Map<string, PermissionDefinition>> | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpPermissionOptions>,
  ) {
    this.options = options.value;
  }

  async getOrNull(name: string): Promise<PermissionDefinition | undefined> {
    return (await this.getPermissionDefinitions()).get(name);
  }

  async getPermissions(): Promise<readonly PermissionDefinition[]> {
    return [...(await this.getPermissionDefinitions()).values()];
  }

  async getResourcePermissionOrNull(resourceName: string, name: string): Promise<PermissionDefinition | undefined> {
    return (await this.getPermissionGroupDefinitions()).resourcePermissions.find((p) => p.resourceName === resourceName && p.name === name);
  }

  async getResourcePermissions(): Promise<readonly PermissionDefinition[]> {
    return [...(await this.getPermissionGroupDefinitions()).resourcePermissions];
  }

  async getGroups(): Promise<readonly PermissionGroupDefinition[]> {
    return [...(await this.getPermissionGroupDefinitions()).groups.values()];
  }

  protected getPermissionGroupDefinitions(): Promise<GroupDefinitions> {
    this.groupDefinitions ??= this.createPermissionGroupDefinitions();
    return this.groupDefinitions;
  }

  protected getPermissionDefinitions(): Promise<Map<string, PermissionDefinition>> {
    this.permissionDefinitions ??= this.createPermissionDefinitions();
    return this.permissionDefinitions;
  }

  protected async createPermissionGroupDefinitions(): Promise<GroupDefinitions> {
    await using scope = this.serviceProvider.createScope();
    const context = new PermissionDefinitionContext(scope.serviceProvider);
    const providers = this.options.definitionProviders.toArray().map((type) => scope.serviceProvider.getRequired(type));
    for (const phase of ["preDefine", "define", "postDefine"] as const) {
      for (const provider of providers) {
        context.currentProvider = provider;
        provider[phase](context);
      }
    }
    context.currentProvider = undefined;
    return { groups: context.groups, resourcePermissions: context.resourcePermissions };
  }

  protected async createPermissionDefinitions(): Promise<Map<string, PermissionDefinition>> {
    const permissions = new Map<string, PermissionDefinition>();
    const { groups } = await this.getPermissionGroupDefinitions();
    for (const group of groups.values()) {
      for (const permission of group.permissions) addPermissionRecursively(permissions, permission);
    }
    return permissions;
  }
}

function addPermissionRecursively(permissions: Map<string, PermissionDefinition>, permission: PermissionDefinition): void {
  if (permissions.has(permission.name)) throw new AbpException(`Duplicate permission name: ${permission.name}`);
  permissions.set(permission.name, permission);
  for (const child of permission.children) addPermissionRecursively(permissions, child);
}

/** Port of `NullDynamicPermissionDefinitionStore`. */
@Singleton(IDynamicPermissionDefinitionStore)
export class NullDynamicPermissionDefinitionStore implements IDynamicPermissionDefinitionStore {
  async getOrNull(): Promise<PermissionDefinition | undefined> {
    return undefined;
  }
  async getPermissions(): Promise<readonly PermissionDefinition[]> {
    return [];
  }
  async getResourcePermissionOrNull(): Promise<PermissionDefinition | undefined> {
    return undefined;
  }
  async getResourcePermissions(): Promise<readonly PermissionDefinition[]> {
    return [];
  }
  async getGroups(): Promise<readonly PermissionGroupDefinition[]> {
    return [];
  }
}

/** Port of `IPermissionDefinitionManager`. */
export interface IPermissionDefinitionManager {
  get(name: string): Promise<PermissionDefinition>;
  getOrNull(name: string): Promise<PermissionDefinition | undefined>;
  getResourcePermission(resourceName: string, name: string): Promise<PermissionDefinition>;
  getResourcePermissionOrNull(resourceName: string, name: string): Promise<PermissionDefinition | undefined>;
  getPermissions(): Promise<readonly PermissionDefinition[]>;
  getResourcePermissions(): Promise<readonly PermissionDefinition[]>;
  getGroups(): Promise<readonly PermissionGroupDefinition[]>;
}
export const IPermissionDefinitionManager = createToken<IPermissionDefinitionManager>("IPermissionDefinitionManager");

/** Port of `PermissionDefinitionManager`: static definitions win over dynamic ones. */
@Transient(IPermissionDefinitionManager)
export class PermissionDefinitionManager implements IPermissionDefinitionManager {
  static readonly inject = [IStaticPermissionDefinitionStore, IDynamicPermissionDefinitionStore] as const;

  constructor(
    private readonly staticStore: IStaticPermissionDefinitionStore,
    private readonly dynamicStore: IDynamicPermissionDefinitionStore,
  ) {}

  async get(name: string): Promise<PermissionDefinition> {
    const permission = await this.getOrNull(name);
    if (!permission) throw new AbpException(`Undefined permission: ${name}`);
    return permission;
  }

  async getOrNull(name: string): Promise<PermissionDefinition | undefined> {
    Check.notNull(name, "name");
    return (await this.staticStore.getOrNull(name)) ?? (await this.dynamicStore.getOrNull(name));
  }

  async getResourcePermission(resourceName: string, name: string): Promise<PermissionDefinition> {
    const permission = await this.getResourcePermissionOrNull(resourceName, name);
    if (!permission) throw new AbpException(`Undefined resource permission: ${name} for resource: ${resourceName}`);
    return permission;
  }

  async getResourcePermissionOrNull(resourceName: string, name: string): Promise<PermissionDefinition | undefined> {
    Check.notNull(name, "name");
    return (await this.staticStore.getResourcePermissionOrNull(resourceName, name)) ?? (await this.dynamicStore.getResourcePermissionOrNull(resourceName, name));
  }

  async getPermissions(): Promise<readonly PermissionDefinition[]> {
    const staticPermissions = await this.staticStore.getPermissions();
    const staticNames = new Set(staticPermissions.map((p) => p.name));
    const dynamicPermissions = await this.dynamicStore.getPermissions();
    return [...staticPermissions, ...dynamicPermissions.filter((d) => !staticNames.has(d.name))];
  }

  async getResourcePermissions(): Promise<readonly PermissionDefinition[]> {
    const staticPermissions = await this.staticStore.getResourcePermissions();
    const staticKeys = new Set(staticPermissions.map((p) => `${p.resourceName} ${p.name}`));
    const dynamicPermissions = await this.dynamicStore.getResourcePermissions();
    return [...staticPermissions, ...dynamicPermissions.filter((d) => !staticKeys.has(`${d.resourceName} ${d.name}`))];
  }

  async getGroups(): Promise<readonly PermissionGroupDefinition[]> {
    const staticGroups = await this.staticStore.getGroups();
    const staticNames = new Set(staticGroups.map((g) => g.name));
    const dynamicGroups = await this.dynamicStore.getGroups();
    return [...staticGroups, ...dynamicGroups.filter((d) => !staticNames.has(d.name))];
  }
}
