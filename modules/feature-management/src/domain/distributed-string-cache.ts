import { DistributedCacheEntryOptions, type IDistributedCacheStore } from "@abp/caching";

/*
 * The .NET saver/dynamic store use the raw `IDistributedCache` string API (`GetStringAsync`/`SetStringAsync`);
 * the port talks to the `IDistributedCacheStore` behind `IDistributedCache<T>` in the same way.
 */

const decoder = new TextDecoder();

/** Sliding expiration of the stamp/hash entries (`TimeSpan.FromDays(30)` in .NET). */
export const StampCacheSlidingExpirationMs = 30 * 24 * 60 * 60 * 1000;

export async function getCachedString(store: IDistributedCacheStore, key: string, signal?: AbortSignal): Promise<string | undefined> {
  const value = await store.get(key, signal);
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : decoder.decode(value);
}

export async function setCachedString(store: IDistributedCacheStore, key: string, value: string, signal?: AbortSignal): Promise<void> {
  await store.set(key, value, new DistributedCacheEntryOptions({ slidingExpiration: StampCacheSlidingExpirationMs }), signal);
}
