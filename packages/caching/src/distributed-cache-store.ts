import { createToken } from "@abp/core";
import type { DistributedCacheEntryOptions } from "./distributed-cache-entry-options.js";

/** A serialized cache value as stored by an `IDistributedCacheStore`. */
export type CacheValue = Uint8Array | string;

/**
 * Port of `Microsoft.Extensions.Caching.Distributed.IDistributedCache` (the raw byte store behind `IDistributedCache<T>`).
 * Implementations store opaque values under normalized string keys and honour the entry options (absolute /
 * sliding expiration). A store may return a `string` instead of bytes (e.g. a DynamoDB string attribute); the
 * serializer accepts both. Optionally implement {@link ICacheSupportsMultipleItems} for batch operations.
 */
export interface IDistributedCacheStore {
  get(key: string, signal?: AbortSignal): Promise<CacheValue | undefined>;
  set(key: string, value: CacheValue, options: DistributedCacheEntryOptions, signal?: AbortSignal): Promise<void>;
  /** Resets the sliding expiration of the entry (no-op when the key is missing). */
  refresh(key: string, signal?: AbortSignal): Promise<void>;
  remove(key: string, signal?: AbortSignal): Promise<void>;
}
export const IDistributedCacheStore = createToken<IDistributedCacheStore>("IDistributedCacheStore");

/** Port of `ICacheSupportsMultipleItems`: batch operations a store may offer. Results keep the order of `keys`. */
export interface ICacheSupportsMultipleItems {
  getMany(keys: readonly string[], signal?: AbortSignal): Promise<(CacheValue | undefined)[]>;
  setMany(items: readonly { key: string; value: CacheValue }[], options: DistributedCacheEntryOptions, signal?: AbortSignal): Promise<void>;
  refreshMany(keys: readonly string[], signal?: AbortSignal): Promise<void>;
  removeMany(keys: readonly string[], signal?: AbortSignal): Promise<void>;
}

export function supportsMultipleItems(store: IDistributedCacheStore): store is IDistributedCacheStore & ICacheSupportsMultipleItems {
  const s = store as Partial<ICacheSupportsMultipleItems>;
  return typeof s.getMany === "function" && typeof s.setMany === "function" && typeof s.refreshMany === "function" && typeof s.removeMany === "function";
}

interface MemoryCacheEntry {
  value: CacheValue;
  readonly absoluteExpiration: number | undefined;
  readonly slidingExpiration: number | undefined;
  expiresAt: number | undefined;
}

/**
 * Port of `MemoryDistributedCache`: an in-process store with lazy expiration. Registered by `AbpCachingModule`
 * unless another store (e.g. the DynamoDB store) was registered first.
 */
export class MemoryDistributedCacheStore implements IDistributedCacheStore, ICacheSupportsMultipleItems {
  private readonly entries = new Map<string, MemoryCacheEntry>();

  get size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  async get(key: string): Promise<CacheValue | undefined> {
    return this.touch(key)?.value;
  }

  async set(key: string, value: CacheValue, options: DistributedCacheEntryOptions): Promise<void> {
    const now = this.now();
    const absolute = options.absoluteExpiration?.getTime() ?? (options.absoluteExpirationRelativeToNow === undefined ? undefined : now + options.absoluteExpirationRelativeToNow);
    const entry: MemoryCacheEntry = { value, absoluteExpiration: absolute, slidingExpiration: options.slidingExpiration, expiresAt: undefined };
    entry.expiresAt = this.nextExpiration(entry, now);
    this.entries.set(key, entry);
  }

  async refresh(key: string): Promise<void> {
    this.touch(key);
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async getMany(keys: readonly string[]): Promise<(CacheValue | undefined)[]> {
    return keys.map((k) => this.touch(k)?.value);
  }

  async setMany(items: readonly { key: string; value: CacheValue }[], options: DistributedCacheEntryOptions): Promise<void> {
    for (const item of items) await this.set(item.key, item.value, options);
  }

  async refreshMany(keys: readonly string[]): Promise<void> {
    for (const k of keys) this.touch(k);
  }

  async removeMany(keys: readonly string[]): Promise<void> {
    for (const k of keys) this.entries.delete(k);
  }

  clear(): void {
    this.entries.clear();
  }

  protected now(): number {
    return Date.now();
  }

  private touch(key: string): MemoryCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = this.now();
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    entry.expiresAt = this.nextExpiration(entry, now);
    return entry;
  }

  private nextExpiration(entry: MemoryCacheEntry, now: number): number | undefined {
    const sliding = entry.slidingExpiration === undefined ? undefined : now + entry.slidingExpiration;
    if (sliding === undefined) return entry.absoluteExpiration;
    if (entry.absoluteExpiration === undefined) return sliding;
    return Math.min(sliding, entry.absoluteExpiration);
  }

  private evictExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
