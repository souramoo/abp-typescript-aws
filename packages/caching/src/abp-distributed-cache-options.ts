import type { AbstractClass } from "@abp/core";
import { CacheNameAttribute } from "./cache-name.js";
import { DistributedCacheEntryOptions } from "./distributed-cache-entry-options.js";

export type CacheConfigurator = (cacheName: string) => DistributedCacheEntryOptions | undefined;

/** Port of `AbpDistributedCacheOptions`. */
export class AbpDistributedCacheOptions {
  /** Throw or hide exceptions for the distributed cache. Default: true. */
  hideErrors = true;
  /** Cache key prefix. */
  keyPrefix = "";
  /** Global cache entry options. */
  globalCacheEntryOptions = new DistributedCacheEntryOptions();
  /** Cache configurators (argument: name of the cache); the first non-undefined result wins. */
  readonly cacheConfigurators: CacheConfigurator[] = [];

  /** Port of `ConfigureCache<TCacheItem>(options)` / `ConfigureCache(cacheName, options)`. */
  configureCache(cacheItemTypeOrName: AbstractClass | string, options: DistributedCacheEntryOptions | undefined): void {
    const cacheName = typeof cacheItemTypeOrName === "string" ? cacheItemTypeOrName : CacheNameAttribute.getCacheName(cacheItemTypeOrName);
    this.cacheConfigurators.push((name) => (cacheName !== name ? undefined : options));
  }
}
