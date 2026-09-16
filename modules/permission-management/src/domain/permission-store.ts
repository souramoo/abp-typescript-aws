import { Check, ILoggerFactory, Transient, type ILogger } from "@abp/core";
import { IPermissionDefinitionManager, IPermissionStore, MultiplePermissionGrantResult, PermissionGrantResult } from "@abp/authorization";
import type { IDistributedCache, KeyValuePair } from "@abp/caching";
import { disableTracking } from "@abp/ddd-domain";
import { IPermissionGrantCache, PermissionGrantCacheItem } from "./permission-grant-cache-item.js";
import { IPermissionGrantRepository } from "./permission-grant-repository.js";

/**
 * Port of `PermissionStore`: the `IPermissionStore` of `@abp/authorization` backed by `PermissionGrant` rows and the
 * distributed cache (a cache miss fills the cache for every defined permission of the provider key at once).
 */
@Transient(IPermissionStore)
export class PermissionStore implements IPermissionStore {
  static readonly inject = [IPermissionGrantRepository, IPermissionGrantCache, IPermissionDefinitionManager, ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly permissionGrantRepository: IPermissionGrantRepository,
    protected readonly cache: IDistributedCache<PermissionGrantCacheItem>,
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(PermissionStore.name);
  }

  async isGranted(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<boolean> {
    return (await this.getCacheItem(name, providerName ?? "", providerKey)).isGranted;
  }

  async isGrantedMany(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<MultiplePermissionGrantResult> {
    Check.notNullOrEmptyArray(names, "names");
    const result = new MultiplePermissionGrantResult();
    const provider = providerName ?? "";

    if (names.length === 1) {
      const name = names[0]!;
      result.result.set(name, (await this.isGranted(name, provider, providerKey)) ? PermissionGrantResult.Granted : PermissionGrantResult.Undefined);
      return result;
    }

    for (const item of await this.getCacheItems(names, provider, providerKey)) {
      const name = this.getPermissionNameFormCacheKeyOrNull(item.key);
      if (name === undefined) continue;
      result.result.set(name, item.value?.isGranted ? PermissionGrantResult.Granted : PermissionGrantResult.Undefined);
    }
    return result;
  }

  protected async getCacheItem(name: string, providerName: string, providerKey: string | undefined): Promise<PermissionGrantCacheItem> {
    const cacheKey = this.calculateCacheKey(name, providerName, providerKey);
    this.logger.debug(`PermissionStore.getCacheItem: ${cacheKey}`);

    const cacheItem = await this.cache.get(cacheKey);
    if (cacheItem) {
      this.logger.debug(`Found in the cache: ${cacheKey}`);
      return cacheItem;
    }
    this.logger.debug(`Not found in the cache: ${cacheKey}`);

    const current = new PermissionGrantCacheItem(false);
    await this.setCacheItemsFor(providerName, providerKey, name, current);
    return current;
  }

  /** Fills the cache for every defined permission of the provider key (port of `SetCacheItemsAsync(providerName, providerKey, currentName, currentCacheItem)`). */
  protected async setCacheItemsFor(providerName: string, providerKey: string | undefined, currentName: string, currentCacheItem: PermissionGrantCacheItem): Promise<void> {
    using _tracking = disableTracking(this.permissionGrantRepository);
    const permissions = await this.permissionDefinitionManager.getPermissions();
    this.logger.debug(`Getting all granted permissions from the repository for this provider name,key: ${providerName},${providerKey}`);
    const grantedPermissions = new Set((await this.permissionGrantRepository.getListByProvider(providerName, providerKey)).map((p) => p.name));

    this.logger.debug(`Setting the cache items. Count: ${permissions.length}`);
    const cacheItems: KeyValuePair<string, PermissionGrantCacheItem>[] = [];
    for (const permission of permissions) {
      const isGranted = grantedPermissions.has(permission.name);
      cacheItems.push({ key: this.calculateCacheKey(permission.name, providerName, providerKey), value: new PermissionGrantCacheItem(isGranted) });
      if (permission.name === currentName) currentCacheItem.isGranted = isGranted;
    }
    await this.cache.setMany(cacheItems);
    this.logger.debug(`Finished setting the cache items. Count: ${permissions.length}`);
  }

  protected async getCacheItems(names: readonly string[], providerName: string, providerKey: string | undefined): Promise<KeyValuePair<string, PermissionGrantCacheItem | undefined>[]> {
    const cacheKeys = names.map((x) => this.calculateCacheKey(x, providerName, providerKey));
    this.logger.debug(`PermissionStore.getCacheItems: ${cacheKeys.join(",")}`);

    const cacheItems = await this.cache.getMany(cacheKeys);
    if (cacheItems.every((x) => x.value !== undefined)) {
      this.logger.debug(`Found in the cache: ${cacheKeys.join(",")}`);
      return cacheItems;
    }

    const notCacheKeys = cacheItems.filter((x) => x.value === undefined).map((x) => x.key);
    this.logger.debug(`Not found in the cache: ${notCacheKeys.join(",")}`);

    const newCacheItems = await this.setCacheItems(providerName, providerKey, notCacheKeys);
    const newCacheItemsByKey = new Map<string, PermissionGrantCacheItem>();
    for (const item of newCacheItems) if (!newCacheItemsByKey.has(item.key)) newCacheItemsByKey.set(item.key, item.value);
    const cacheItemsByKey = new Map<string, PermissionGrantCacheItem | undefined>();
    for (const item of cacheItems) if (!cacheItemsByKey.has(item.key)) cacheItemsByKey.set(item.key, item.value);

    return cacheKeys.map((key) => ({ key, value: newCacheItemsByKey.get(key) ?? cacheItemsByKey.get(key) }));
  }

  /** Fills the cache for the missing keys only (port of `SetCacheItemsAsync(providerName, providerKey, notCacheKeys)`). */
  protected async setCacheItems(providerName: string, providerKey: string | undefined, notCacheKeys: readonly string[]): Promise<KeyValuePair<string, PermissionGrantCacheItem>[]> {
    using _tracking = disableTracking(this.permissionGrantRepository);
    const permissionNames = new Set(notCacheKeys.map((key) => this.getPermissionNameFormCacheKeyOrNull(key)).filter((name): name is string => name !== undefined));
    const permissions = (await this.permissionDefinitionManager.getPermissions()).filter((x) => permissionNames.has(x.name));

    this.logger.debug(`Getting not cache granted permissions from the repository for this provider name,key: ${providerName},${providerKey}`);
    const grantedPermissions = new Set((await this.permissionGrantRepository.getListByNames([...permissionNames], providerName, providerKey)).map((p) => p.name));

    this.logger.debug(`Setting the cache items. Count: ${permissions.length}`);
    const cacheItems = permissions.map((permission) => ({ key: this.calculateCacheKey(permission.name, providerName, providerKey), value: new PermissionGrantCacheItem(grantedPermissions.has(permission.name)) }));
    await this.cache.setMany(cacheItems);
    this.logger.debug(`Finished setting the cache items. Count: ${permissions.length}`);
    return cacheItems;
  }

  protected calculateCacheKey(name: string, providerName: string, providerKey: string | undefined): string {
    return PermissionGrantCacheItem.calculateCacheKey(name, providerName, providerKey);
  }

  protected getPermissionNameFormCacheKeyOrNull(key: string): string | undefined {
    return PermissionGrantCacheItem.getPermissionNameFormCacheKeyOrNull(key);
  }
}
