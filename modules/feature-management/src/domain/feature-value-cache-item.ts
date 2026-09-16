import { Transient } from "@abp/core";
import { distributedCacheToken, type IDistributedCache } from "@abp/caching";
import { EntityChangedEventData } from "@abp/ddd-domain";
import { LocalEventHandler, type ILocalEventHandler } from "@abp/event-bus";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { FeatureValue } from "./feature-value.js";

/** Port of `FeatureValueCacheItem`. The cache key is `pn:{providerName},pk:{providerKey},n:{name}`. */
@IgnoreMultiTenancy()
export class FeatureValueCacheItem {
  value: string | undefined;

  constructor(value?: string) {
    this.value = value;
  }

  static calculateCacheKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
    return `pn:${providerName ?? ""},pk:${providerKey ?? ""},n:${name}`;
  }
}

/** `IDistributedCache<FeatureValueCacheItem>`. */
export const IFeatureValueCache = distributedCacheToken(FeatureValueCacheItem);

/** Port of `FeatureValueCacheItemInvalidator`: removes the cached value when a `FeatureValue` is created, updated or deleted. */
@Transient()
@LocalEventHandler(EntityChangedEventData.of(FeatureValue))
export class FeatureValueCacheItemInvalidator implements ILocalEventHandler<EntityChangedEventData<FeatureValue>> {
  static readonly inject = [IFeatureValueCache] as const;

  constructor(protected readonly cache: IDistributedCache<FeatureValueCacheItem>) {}

  async handleEvent(eventData: EntityChangedEventData<FeatureValue>): Promise<void> {
    const cacheKey = this.calculateCacheKey(eventData.entity.name, eventData.entity.providerName, eventData.entity.providerKey);
    await this.cache.remove(cacheKey, { considerUow: true });
  }

  protected calculateCacheKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
    return FeatureValueCacheItem.calculateCacheKey(name, providerName, providerKey);
  }
}
