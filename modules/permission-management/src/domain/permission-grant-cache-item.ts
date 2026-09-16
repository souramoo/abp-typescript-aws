import { Transient } from "@abp/core";
import { distributedCacheToken, type IDistributedCache } from "@abp/caching";
import { EntityChangedEventData } from "@abp/ddd-domain";
import { LocalEventHandler, type ILocalEventHandler } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { PermissionGrant } from "./permission-grant.js";

const CacheKeyPrefix = "pn:";
const CacheKeyNameSeparator = ",n:";

/** Port of `PermissionGrantCacheItem` (cache name `PermissionGrant`, key `pn:{providerName},pk:{providerKey},n:{name}`). */
export class PermissionGrantCacheItem {
  isGranted: boolean;

  constructor(isGranted = false) {
    this.isGranted = isGranted;
  }

  static calculateCacheKey(name: string, providerName: string, providerKey: string | undefined): string {
    return `${CacheKeyPrefix}${providerName},pk:${providerKey ?? ""}${CacheKeyNameSeparator}${name}`;
  }

  /** Port of `GetPermissionNameFormCacheKeyOrNull` (the name is the last `,n:` segment, so keys may contain commas). */
  static getPermissionNameFormCacheKeyOrNull(cacheKey: string): string | undefined {
    if (!cacheKey.startsWith(CacheKeyPrefix)) return undefined;
    const index = cacheKey.lastIndexOf(CacheKeyNameSeparator);
    return index < 0 ? undefined : cacheKey.slice(index + CacheKeyNameSeparator.length);
  }
}

/** The `IDistributedCache<PermissionGrantCacheItem>` token. */
export const IPermissionGrantCache = distributedCacheToken(PermissionGrantCacheItem);

/** Port of `PermissionGrantCacheItemInvalidator`: drops the cached grant whenever a `PermissionGrant` changes. */
@Transient()
@LocalEventHandler(EntityChangedEventData.of(PermissionGrant))
export class PermissionGrantCacheItemInvalidator implements ILocalEventHandler<EntityChangedEventData<PermissionGrant>> {
  static readonly inject = [IPermissionGrantCache, ICurrentTenant] as const;

  constructor(
    protected readonly cache: IDistributedCache<PermissionGrantCacheItem>,
    protected readonly currentTenant: ICurrentTenant,
  ) {}

  async handleEvent(eventData: EntityChangedEventData<PermissionGrant>): Promise<void> {
    const cacheKey = this.calculateCacheKey(eventData.entity.name, eventData.entity.providerName, eventData.entity.providerKey);
    await this.currentTenant.run(eventData.entity.tenantId, undefined, () => this.cache.remove(cacheKey, { considerUow: true }));
  }

  protected calculateCacheKey(name: string, providerName: string, providerKey: string | undefined): string {
    return PermissionGrantCacheItem.calculateCacheKey(name, providerName, providerKey);
  }
}
