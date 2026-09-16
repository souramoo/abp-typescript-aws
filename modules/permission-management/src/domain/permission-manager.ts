import { AbpException, Check, IRootServiceProvider, Singleton, createToken, optionsToken, type IOptions, type IServiceProvider, type ISimpleStateCheckerManager, type Guid } from "@abp/core";
import type { IDistributedCache } from "@abp/caching";
import { IPermissionDefinitionManager, IPermissionStateCheckerManager, type PermissionDefinition } from "@abp/authorization";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant, MultiTenancySides, getMultiTenancySide, hasMultiTenancySide } from "@abp/multi-tenancy-abstractions";
import { IPermissionGrantCache, PermissionGrantCacheItem } from "./permission-grant-cache-item.js";
import type { PermissionGrant } from "./permission-grant.js";
import { IPermissionGrantRepository } from "./permission-grant-repository.js";
import { PermissionManagementOptions } from "./permission-management-options.js";
import type { IPermissionManagementProvider } from "./permission-management-provider.js";

/** Port of `PermissionValueProviderInfo`: a provider (`R`) and key (`admin`) that grants a permission. */
export class PermissionValueProviderInfo {
  constructor(
    readonly name: string,
    readonly key: string,
  ) {
    Check.notNull(name, "name");
    Check.notNull(key, "key");
  }
}

/** Port of `PermissionWithGrantedProviders`. */
export class PermissionWithGrantedProviders {
  readonly providers: PermissionValueProviderInfo[] = [];

  constructor(
    readonly name: string,
    public isGranted: boolean,
  ) {
    Check.notNull(name, "name");
  }
}

/** Port of `MultiplePermissionWithGrantedProviders`. */
export class MultiplePermissionWithGrantedProviders {
  readonly result: PermissionWithGrantedProviders[] = [];

  constructor(names?: readonly string[]) {
    if (names === undefined) return;
    for (const name of Check.notNull(names, "names")) this.result.push(new PermissionWithGrantedProviders(name, false));
  }
}

/** Port of `IPermissionManager` (the `GetAsync(string[])` overload is the array form of `get`). */
export interface IPermissionManager {
  get(permissionName: string, providerName: string, providerKey: string): Promise<PermissionWithGrantedProviders>;
  get(permissionNames: readonly string[], providerName: string, providerKey: string): Promise<MultiplePermissionWithGrantedProviders>;
  getAll(providerName: string, providerKey: string): Promise<PermissionWithGrantedProviders[]>;
  set(permissionName: string, providerName: string, providerKey: string, isGranted: boolean): Promise<void>;
  updateProviderKey(permissionGrant: PermissionGrant, providerKey: string): Promise<PermissionGrant>;
  delete(providerName: string, providerKey: string): Promise<void>;
}
export const IPermissionManager = createToken<IPermissionManager>("IPermissionManager");

/** Port of `PermissionManager`. */
@Singleton(IPermissionManager)
export class PermissionManager implements IPermissionManager {
  static readonly inject = [IPermissionDefinitionManager, IPermissionStateCheckerManager, IPermissionGrantRepository, IRootServiceProvider, IGuidGenerator, optionsToken(PermissionManagementOptions), ICurrentTenant, IPermissionGrantCache] as const;
  protected readonly options: PermissionManagementOptions;
  private providers: IPermissionManagementProvider[] | undefined;

  constructor(
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    protected readonly simpleStateCheckerManager: ISimpleStateCheckerManager<PermissionDefinition>,
    protected readonly permissionGrantRepository: IPermissionGrantRepository,
    private readonly serviceProvider: IServiceProvider,
    protected readonly guidGenerator: IGuidGenerator,
    options: IOptions<PermissionManagementOptions>,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly cache: IDistributedCache<PermissionGrantCacheItem>,
  ) {
    this.options = options.value;
  }

  /** Port of the lazy `ManagementProviders` list: resolved from `PermissionManagementOptions.managementProviders` once. */
  protected get managementProviders(): readonly IPermissionManagementProvider[] {
    this.providers ??= this.options.managementProviders.toArray().map((type) => this.serviceProvider.getRequired(type));
    return this.providers;
  }

  get(permissionName: string, providerName: string, providerKey: string): Promise<PermissionWithGrantedProviders>;
  get(permissionNames: readonly string[], providerName: string, providerKey: string): Promise<MultiplePermissionWithGrantedProviders>;
  async get(permissionNameOrNames: string | readonly string[], providerName: string, providerKey: string): Promise<PermissionWithGrantedProviders | MultiplePermissionWithGrantedProviders> {
    if (typeof permissionNameOrNames === "string") {
      const permission = await this.permissionDefinitionManager.getOrNull(permissionNameOrNames);
      if (!permission) return new PermissionWithGrantedProviders(permissionNameOrNames, false);
      return this.getInternal(permission, providerName, providerKey);
    }

    const permissions: PermissionDefinition[] = [];
    const undefinedPermissions: string[] = [];
    for (const permissionName of permissionNameOrNames) {
      const permission = await this.permissionDefinitionManager.getOrNull(permissionName);
      if (permission) permissions.push(permission);
      else undefinedPermissions.push(permissionName);
    }
    if (permissions.length === 0) return new MultiplePermissionWithGrantedProviders(undefinedPermissions);

    const result = await this.getInternalMany(permissions, providerName, providerKey);
    for (const undefinedPermission of undefinedPermissions) result.result.push(new PermissionWithGrantedProviders(undefinedPermission, false));
    return result;
  }

  async getAll(providerName: string, providerKey: string): Promise<PermissionWithGrantedProviders[]> {
    const permissionDefinitions = await this.permissionDefinitionManager.getPermissions();
    return (await this.getInternalMany(permissionDefinitions, providerName, providerKey)).result;
  }

  async set(permissionName: string, providerName: string, providerKey: string, isGranted: boolean): Promise<void> {
    const permission = await this.permissionDefinitionManager.getOrNull(permissionName);
    /* Silently ignore undefined permissions, maybe they were removed from dynamic permission definition store */
    if (!permission) return;

    if (!permission.isEnabled || !(await this.simpleStateCheckerManager.isEnabled(permission))) {
      throw new AbpException(`The permission named '${permission.name}' is disabled!`);
    }
    if (permission.providers.length > 0 && !permission.providers.includes(providerName)) {
      throw new AbpException(`The permission named '${permission.name}' is not compatible with the provider named '${providerName}'`);
    }
    const currentSide = getMultiTenancySide(this.currentTenant);
    if (!hasMultiTenancySide(permission.multiTenancySide, currentSide)) {
      throw new AbpException(`The permission named '${permission.name}' has multitenancy side '${MultiTenancySides[permission.multiTenancySide]}' which is not compatible with the current multitenancy side '${MultiTenancySides[currentSide]}'`);
    }

    const currentGrantInfo = await this.getInternal(permission, providerName, providerKey);
    if (currentGrantInfo.isGranted === isGranted) return;

    const provider = this.managementProviders.find((m) => m.name === providerName);
    if (!provider) throw new AbpException(`Unknown permission management provider: ${providerName}`);
    await provider.set(permissionName, providerKey, isGranted);
  }

  async updateProviderKey(permissionGrant: PermissionGrant, providerKey: string): Promise<PermissionGrant> {
    const tenantId: Guid | undefined = permissionGrant.tenantId;
    await this.currentTenant.run(tenantId, undefined, () => this.cache.remove(PermissionGrantCacheItem.calculateCacheKey(permissionGrant.name, permissionGrant.providerName, permissionGrant.providerKey)));
    permissionGrant.providerKey = providerKey;
    return this.permissionGrantRepository.update(permissionGrant, true);
  }

  async delete(providerName: string, providerKey: string): Promise<void> {
    const permissionGrants = await this.permissionGrantRepository.getListByProvider(providerName, providerKey);
    for (const permissionGrant of permissionGrants) await this.permissionGrantRepository.delete(permissionGrant, true);
  }

  protected async getInternal(permission: PermissionDefinition, providerName: string, providerKey: string): Promise<PermissionWithGrantedProviders> {
    const multiple = await this.getInternalMany([permission], providerName, providerKey);
    return multiple.result[0]!;
  }

  protected async getInternalMany(permissions: readonly PermissionDefinition[], providerName: string, providerKey: string): Promise<MultiplePermissionWithGrantedProviders> {
    const multiple = new MultiplePermissionWithGrantedProviders(permissions.map((x) => x.name));
    const currentSide = getMultiTenancySide(this.currentTenant);
    const stateCheckPermissions = [...new Set(permissions.filter((x) => x.isEnabled && hasMultiTenancySide(x.multiTenancySide, currentSide) && (x.providers.length === 0 || x.providers.includes(providerName))))];

    const stateCheckResult = stateCheckPermissions.length > 0 ? await this.simpleStateCheckerManager.isEnabledMany(stateCheckPermissions) : new Map<PermissionDefinition, boolean>();
    const neededCheckPermissions = stateCheckPermissions.filter((p) => stateCheckResult.get(p) === true);
    if (neededCheckPermissions.length === 0) return multiple;

    const byName = new Map<string, PermissionWithGrantedProviders>();
    for (const item of multiple.result) if (!byName.has(item.name)) byName.set(item.name, item);

    const permissionNames = neededCheckPermissions.map((x) => x.name);
    for (const provider of this.managementProviders) {
      const providerResult = await provider.checkMany(permissionNames, providerName, providerKey);
      for (const [name, grantInfo] of providerResult.result) {
        if (!grantInfo.isGranted) continue;
        const permissionWithGrantedProviders = byName.get(name);
        if (!permissionWithGrantedProviders) continue;
        permissionWithGrantedProviders.isGranted = true;
        permissionWithGrantedProviders.providers.push(new PermissionValueProviderInfo(provider.name, grantInfo.providerKey ?? providerKey));
      }
    }
    return multiple;
  }
}
