import { Transient } from "@abp/core";
import { distributedCacheToken, type IDistributedCache } from "@abp/caching";
import { EntityChangedEventData } from "@abp/ddd-domain";
import { LocalEventHandler, type ILocalEventHandler } from "@abp/event-bus";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { Setting } from "./setting.js";

const CacheKeyPrefix = "pn:";
const CacheKeyNameSeparator = ",n:";

/** Port of `SettingCacheItem`. The cache key is `pn:{providerName},pk:{providerKey},n:{name}`. */
@IgnoreMultiTenancy()
export class SettingCacheItem {
  value: string | undefined;

  constructor(value?: string) {
    this.value = value;
  }

  static calculateCacheKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
    return `${CacheKeyPrefix}${providerName ?? ""},pk:${providerKey ?? ""}${CacheKeyNameSeparator}${name}`;
  }

  /** Port of `GetSettingNameFormCacheKeyOrNull` (the `FormattedStringValueExtracter` becomes a suffix lookup). */
  static getSettingNameFormCacheKeyOrNull(cacheKey: string): string | undefined {
    if (!cacheKey.startsWith(CacheKeyPrefix)) return undefined;
    const index = cacheKey.lastIndexOf(CacheKeyNameSeparator);
    return index < 0 ? undefined : cacheKey.slice(index + CacheKeyNameSeparator.length);
  }
}

/** `IDistributedCache<SettingCacheItem>`. */
export const ISettingCache = distributedCacheToken(SettingCacheItem);

/** Port of `SettingCacheItemInvalidator`: removes the cached value when a `Setting` is created, updated or deleted. */
@Transient()
@LocalEventHandler(EntityChangedEventData.of(Setting))
export class SettingCacheItemInvalidator implements ILocalEventHandler<EntityChangedEventData<Setting>> {
  static readonly inject = [ISettingCache] as const;

  constructor(protected readonly cache: IDistributedCache<SettingCacheItem>) {}

  async handleEvent(eventData: EntityChangedEventData<Setting>): Promise<void> {
    const cacheKey = this.calculateCacheKey(eventData.entity.name, eventData.entity.providerName, eventData.entity.providerKey);
    await this.cache.remove(cacheKey, { considerUow: true });
  }

  protected calculateCacheKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
    return SettingCacheItem.calculateCacheKey(name, providerName, providerKey);
  }
}
