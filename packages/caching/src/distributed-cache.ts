import {
  AbpException,
  AsyncLock,
  ExceptionNotificationContext,
  ICancellationTokenProvider,
  IExceptionNotifier,
  ILoggerFactory,
  LogLevel,
  createToken,
  keyedToken,
  type Class,
  type ILogger,
  type IServiceProvider,
  type ServiceCollection,
  type ServiceToken,
} from "@abp/core";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager, getOrAddItem } from "@abp/uow";
import { AbpDistributedCacheOptions } from "./abp-distributed-cache-options.js";
import { CacheNameAttribute } from "./cache-name.js";
import { DistributedCacheKeyNormalizeArgs, IDistributedCacheKeyNormalizer } from "./distributed-cache-key-normalizer.js";
import { IDistributedCacheSerializer } from "./distributed-cache-serializer.js";
import { IDistributedCacheStore, supportsMultipleItems, type CacheValue } from "./distributed-cache-store.js";
import type { DistributedCacheEntryOptions } from "./distributed-cache-entry-options.js";
import { UnitOfWorkCacheItem, getUnRemovedValueOrNull } from "./unit-of-work-cache-item.js";

/** Port of `KeyValuePair<TKey, TValue>` used by the batch cache operations. */
export interface KeyValuePair<TKey, TValue> {
  readonly key: TKey;
  readonly value: TValue;
}

/** The `hideErrors` / `considerUow` / cancellation parameters of the .NET methods, as an options object. */
export interface CacheCallOptions {
  /** Throw or hide exceptions of the store; defaults to `AbpDistributedCacheOptions.hideErrors`. */
  hideErrors?: boolean;
  /** Keeps the change in the current unit of work and applies it to the real cache when it completes. */
  considerUow?: boolean;
  signal?: AbortSignal;
}
export type CacheRefreshOptions = Omit<CacheCallOptions, "considerUow">;

export type CacheItemFactory<TCacheItem> = () => TCacheItem | Promise<TCacheItem>;
export type CacheItemsFactory<TCacheItem, TCacheKey> = (missingKeys: TCacheKey[]) => KeyValuePair<TCacheKey, TCacheItem>[] | Promise<KeyValuePair<TCacheKey, TCacheItem>[]>;
export type CacheEntryOptionsFactory = () => DistributedCacheEntryOptions;

/**
 * Port of `IDistributedCache<TCacheItem, TCacheKey>` (async members only; the store is asynchronous here).
 * Keys are strings, or objects whose `toString()` yields the cache key.
 */
export interface IDistributedCache<TCacheItem extends object, TCacheKey = string> {
  readonly cacheName: string;
  get(key: TCacheKey, options?: CacheCallOptions): Promise<TCacheItem | undefined>;
  /** Returns one pair per requested key (in order); `value` is undefined for keys not in the cache. */
  getMany(keys: Iterable<TCacheKey>, options?: CacheCallOptions): Promise<KeyValuePair<TCacheKey, TCacheItem | undefined>[]>;
  getOrAdd(key: TCacheKey, factory: CacheItemFactory<TCacheItem>, optionsFactory?: CacheEntryOptionsFactory, options?: CacheCallOptions): Promise<TCacheItem | undefined>;
  getOrAddMany(keys: Iterable<TCacheKey>, factory: CacheItemsFactory<TCacheItem, TCacheKey>, optionsFactory?: CacheEntryOptionsFactory, options?: CacheCallOptions): Promise<KeyValuePair<TCacheKey, TCacheItem | undefined>[]>;
  set(key: TCacheKey, value: TCacheItem, entryOptions?: DistributedCacheEntryOptions, options?: CacheCallOptions): Promise<void>;
  setMany(items: Iterable<KeyValuePair<TCacheKey, TCacheItem>>, entryOptions?: DistributedCacheEntryOptions, options?: CacheCallOptions): Promise<void>;
  refresh(key: TCacheKey, options?: CacheRefreshOptions): Promise<void>;
  refreshMany(keys: Iterable<TCacheKey>, options?: CacheRefreshOptions): Promise<void>;
  remove(key: TCacheKey, options?: CacheCallOptions): Promise<void>;
  removeMany(keys: Iterable<TCacheKey>, options?: CacheCallOptions): Promise<void>;
}

const IDistributedCacheBase = createToken<unknown>("IDistributedCache");
const knownCacheItemTypes = new Set<Class>();

/**
 * Token for `IDistributedCache<TCacheItem, TCacheKey>` (closed generic). The container has no open-generic
 * registration, so the token must be created before the service provider is built (a `static inject`, a
 * module-level constant, or {@link addDistributedCache} in `configureServices`); `AbpCachingModule` registers a
 * cache for every item type seen by this function when it post-configures services.
 */
export function distributedCacheToken<TCacheItem extends object, TCacheKey = string>(cacheItemType: Class<TCacheItem>): ServiceToken<IDistributedCache<TCacheItem, TCacheKey>> {
  knownCacheItemTypes.add(cacheItemType);
  return keyedToken<IDistributedCache<TCacheItem, TCacheKey>>(IDistributedCacheBase, cacheItemType);
}

/** Port of `services.AddSingleton(typeof(IDistributedCache<,>), typeof(DistributedCache<,>))` for one item type. */
export function addDistributedCache<TCacheItem extends object>(services: ServiceCollection, cacheItemType: Class<TCacheItem>): void {
  const token = distributedCacheToken(cacheItemType);
  if (services.isRegistered(token)) return;
  services.addSingleton(token, { useFactory: (provider) => DistributedCache.create(cacheItemType, provider) });
}

export function registerDistributedCaches(services: ServiceCollection): void {
  for (const type of knownCacheItemTypes) addDistributedCache(services, type);
}

type UowCache<TCacheItem extends object> = Map<string, UnitOfWorkCacheItem<TCacheItem>>;

/** Port of `DistributedCache<TCacheItem, TCacheKey>`. Created per item type by {@link DistributedCache.create}. */
export class DistributedCache<TCacheItem extends object, TCacheKey = string> implements IDistributedCache<TCacheItem, TCacheKey> {
  static readonly UowCacheName = "AbpDistributedCache";

  readonly cacheName: string;
  protected readonly ignoreMultiTenancy: boolean;
  protected readonly logger: ILogger;
  protected readonly syncSemaphore = new AsyncLock();
  protected defaultCacheOptions: DistributedCacheEntryOptions;

  constructor(
    protected readonly cacheItemType: Class<TCacheItem>,
    protected readonly distributedCacheOptions: AbpDistributedCacheOptions,
    protected readonly cache: IDistributedCacheStore,
    protected readonly cancellationTokenProvider: ICancellationTokenProvider,
    protected readonly serializer: IDistributedCacheSerializer,
    protected readonly keyNormalizer: IDistributedCacheKeyNormalizer,
    protected readonly serviceScopeFactory: IServiceProvider,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    loggerFactory: ILoggerFactory,
  ) {
    this.cacheName = CacheNameAttribute.getCacheName(cacheItemType);
    this.ignoreMultiTenancy = IgnoreMultiTenancy.has(cacheItemType);
    this.logger = loggerFactory.createLogger(`DistributedCache<${cacheItemType.name}>`);
    this.defaultCacheOptions = this.getDefaultCacheEntryOptions();
  }

  static create<TCacheItem extends object, TCacheKey = string>(cacheItemType: Class<TCacheItem>, provider: IServiceProvider): DistributedCache<TCacheItem, TCacheKey> {
    return new DistributedCache<TCacheItem, TCacheKey>(
      cacheItemType,
      provider.getOptions(AbpDistributedCacheOptions),
      provider.getRequired(IDistributedCacheStore),
      provider.getRequired(ICancellationTokenProvider),
      provider.getRequired(IDistributedCacheSerializer),
      provider.getRequired(IDistributedCacheKeyNormalizer),
      provider,
      provider.getRequired(IUnitOfWorkManager),
      provider.getRequired(ILoggerFactory),
    );
  }

  protected normalizeKey(key: TCacheKey): string {
    return this.keyNormalizer.normalizeKey(new DistributedCacheKeyNormalizeArgs(String(key), this.cacheName, this.ignoreMultiTenancy));
  }

  protected getDefaultCacheEntryOptions(): DistributedCacheEntryOptions {
    for (const configure of this.distributedCacheOptions.cacheConfigurators) {
      const options = configure(this.cacheName);
      if (options !== undefined) return options;
    }
    return this.distributedCacheOptions.globalCacheEntryOptions;
  }

  async get(key: TCacheKey, { hideErrors, considerUow = false, signal }: CacheCallOptions = {}): Promise<TCacheItem | undefined> {
    hideErrors ??= this.distributedCacheOptions.hideErrors;

    if (this.shouldConsiderUow(considerUow)) {
      const value = getUnRemovedValueOrNull(this.getUnitOfWorkCache().get(String(key)));
      if (value !== undefined) return value;
    }

    let cachedBytes: CacheValue | undefined;
    try {
      cachedBytes = await this.cache.get(this.normalizeKey(key), this.cancellationTokenProvider.fallbackToProvider(signal));
    } catch (e) {
      if (hideErrors) {
        await this.handleException(e);
        return undefined;
      }
      throw e;
    }
    return this.toCacheItem(cachedBytes);
  }

  async getMany(keys: Iterable<TCacheKey>, { hideErrors, considerUow = false, signal }: CacheCallOptions = {}): Promise<KeyValuePair<TCacheKey, TCacheItem | undefined>[]> {
    const keyArray = [...keys];
    const cache = this.cache;
    if (!supportsMultipleItems(cache)) return this.getManyFallback(keyArray, hideErrors, considerUow, signal);

    let notCachedKeys: TCacheKey[] = [];
    const cachedValues: KeyValuePair<TCacheKey, TCacheItem | undefined>[] = [];
    if (this.shouldConsiderUow(considerUow)) {
      const uowCache = this.getUnitOfWorkCache();
      for (const key of keyArray) {
        const value = getUnRemovedValueOrNull(uowCache.get(String(key)));
        if (value !== undefined) cachedValues.push({ key, value });
      }
      notCachedKeys = keyArray.filter((k) => !cachedValues.some((c) => c.key === k));
      if (notCachedKeys.length === 0) return cachedValues;
    }

    hideErrors ??= this.distributedCacheOptions.hideErrors;
    const readKeys = notCachedKeys.length > 0 ? notCachedKeys : keyArray;
    let cachedBytes: (CacheValue | undefined)[];
    try {
      cachedBytes = await cache.getMany(
        readKeys.map((k) => this.normalizeKey(k)),
        this.cancellationTokenProvider.fallbackToProvider(signal),
      );
    } catch (e) {
      if (hideErrors) {
        await this.handleException(e);
        return DistributedCache.toCacheItemsWithDefaultValues(keyArray);
      }
      throw e;
    }
    return [...cachedValues, ...this.toCacheItems(cachedBytes, readKeys)];
  }

  protected async getManyFallback(keys: TCacheKey[], hideErrors: boolean | undefined, considerUow: boolean, signal: AbortSignal | undefined): Promise<KeyValuePair<TCacheKey, TCacheItem | undefined>[]> {
    hideErrors ??= this.distributedCacheOptions.hideErrors;
    try {
      const result: KeyValuePair<TCacheKey, TCacheItem | undefined>[] = [];
      for (const key of keys) result.push({ key, value: await this.get(key, { hideErrors: false, considerUow, signal }) });
      return result;
    } catch (e) {
      if (hideErrors) {
        await this.handleException(e);
        return DistributedCache.toCacheItemsWithDefaultValues(keys);
      }
      throw e;
    }
  }

  async getOrAdd(key: TCacheKey, factory: CacheItemFactory<TCacheItem>, optionsFactory?: CacheEntryOptionsFactory, options: CacheCallOptions = {}): Promise<TCacheItem | undefined> {
    const signal = this.cancellationTokenProvider.fallbackToProvider(options.signal);
    const callOptions = { ...options, signal };
    const existing = await this.get(key, callOptions);
    if (existing !== undefined) return existing;

    return this.syncSemaphore.lock(async () => {
      const value = await this.get(key, callOptions);
      if (value !== undefined) return value;

      const created = await factory();
      if (this.shouldConsiderUow(options.considerUow ?? false)) this.setUnitOfWorkValue(key, created);
      await this.set(key, created, optionsFactory?.(), callOptions);
      return created;
    });
  }

  async getOrAddMany(keys: Iterable<TCacheKey>, factory: CacheItemsFactory<TCacheItem, TCacheKey>, optionsFactory?: CacheEntryOptionsFactory, options: CacheCallOptions = {}): Promise<KeyValuePair<TCacheKey, TCacheItem | undefined>[]> {
    const keyArray = [...keys];
    const result = await this.getMany(keyArray, options);

    const resultMap = new Map<string, TCacheItem>();
    for (const pair of result) if (pair.value !== undefined) resultMap.set(String(pair.key), pair.value);

    if (resultMap.size === keyArray.length) return keyArray.map((key) => ({ key, value: resultMap.get(String(key)) }));

    const missingKeys = keyArray.filter((key) => !resultMap.has(String(key)));
    const missingValues = await factory(missingKeys);
    await this.setMany(missingValues, optionsFactory?.(), options);
    for (const pair of missingValues) resultMap.set(String(pair.key), pair.value);

    return keyArray.map((key) => ({ key, value: resultMap.get(String(key)) }));
  }

  async set(key: TCacheKey, value: TCacheItem, entryOptions?: DistributedCacheEntryOptions, { hideErrors, considerUow = false, signal }: CacheCallOptions = {}): Promise<void> {
    const setRealCache = async () => {
      hideErrors ??= this.distributedCacheOptions.hideErrors;
      try {
        await this.cache.set(this.normalizeKey(key), this.serializer.serialize(value), entryOptions ?? this.defaultCacheOptions, this.cancellationTokenProvider.fallbackToProvider(signal));
      } catch (e) {
        if (hideErrors) {
          await this.handleException(e);
          return;
        }
        throw e;
      }
    };

    if (this.shouldConsiderUow(considerUow)) {
      this.setUnitOfWorkValue(key, value);
      this.unitOfWorkManager.current?.onCompleted(setRealCache);
    } else {
      await setRealCache();
    }
  }

  async setMany(items: Iterable<KeyValuePair<TCacheKey, TCacheItem>>, entryOptions?: DistributedCacheEntryOptions, { hideErrors, considerUow = false, signal }: CacheCallOptions = {}): Promise<void> {
    const itemsArray = [...items];
    const cache = this.cache;
    if (!supportsMultipleItems(cache)) {
      await this.setManyFallback(itemsArray, entryOptions, hideErrors, considerUow, signal);
      return;
    }

    const setRealCache = async () => {
      hideErrors ??= this.distributedCacheOptions.hideErrors;
      try {
        await cache.setMany(this.toRawCacheItems(itemsArray), entryOptions ?? this.defaultCacheOptions, this.cancellationTokenProvider.fallbackToProvider(signal));
      } catch (e) {
        if (hideErrors) {
          await this.handleException(e);
          return;
        }
        throw e;
      }
    };

    if (this.shouldConsiderUow(considerUow)) {
      for (const pair of itemsArray) this.setUnitOfWorkValue(pair.key, pair.value);
      this.unitOfWorkManager.current?.onCompleted(setRealCache);
    } else {
      await setRealCache();
    }
  }

  protected async setManyFallback(items: KeyValuePair<TCacheKey, TCacheItem>[], entryOptions: DistributedCacheEntryOptions | undefined, hideErrors: boolean | undefined, considerUow: boolean, signal: AbortSignal | undefined): Promise<void> {
    hideErrors ??= this.distributedCacheOptions.hideErrors;
    try {
      for (const item of items) await this.set(item.key, item.value, entryOptions, { hideErrors: false, considerUow, signal });
    } catch (e) {
      if (hideErrors) {
        await this.handleException(e);
        return;
      }
      throw e;
    }
  }

  async refresh(key: TCacheKey, { hideErrors, signal }: CacheRefreshOptions = {}): Promise<void> {
    hideErrors ??= this.distributedCacheOptions.hideErrors;
    try {
      await this.cache.refresh(this.normalizeKey(key), this.cancellationTokenProvider.fallbackToProvider(signal));
    } catch (e) {
      if (hideErrors) {
        await this.handleException(e);
        return;
      }
      throw e;
    }
  }

  async refreshMany(keys: Iterable<TCacheKey>, { hideErrors, signal }: CacheRefreshOptions = {}): Promise<void> {
    hideErrors ??= this.distributedCacheOptions.hideErrors;
    const cache = this.cache;
    const fallbackSignal = this.cancellationTokenProvider.fallbackToProvider(signal);
    try {
      if (supportsMultipleItems(cache)) {
        await cache.refreshMany([...keys].map((k) => this.normalizeKey(k)), fallbackSignal);
      } else {
        for (const key of keys) await cache.refresh(this.normalizeKey(key), fallbackSignal);
      }
    } catch (e) {
      if (hideErrors) {
        await this.handleException(e);
        return;
      }
      throw e;
    }
  }

  async remove(key: TCacheKey, { hideErrors, considerUow = false, signal }: CacheCallOptions = {}): Promise<void> {
    const removeRealCache = async () => {
      hideErrors ??= this.distributedCacheOptions.hideErrors;
      try {
        await this.cache.remove(this.normalizeKey(key), this.cancellationTokenProvider.fallbackToProvider(signal));
      } catch (e) {
        if (hideErrors) {
          await this.handleException(e);
          return;
        }
        throw e;
      }
    };

    if (this.shouldConsiderUow(considerUow)) {
      this.getUnitOfWorkCache().get(String(key))?.removeValue();
      this.unitOfWorkManager.current?.onCompleted(removeRealCache);
    } else {
      await removeRealCache();
    }
  }

  async removeMany(keys: Iterable<TCacheKey>, { hideErrors, considerUow = false, signal }: CacheCallOptions = {}): Promise<void> {
    const keyArray = [...keys];
    const cache = this.cache;
    if (!supportsMultipleItems(cache)) {
      for (const key of keyArray) await this.remove(key, { hideErrors, considerUow, signal });
      return;
    }

    const removeRealCache = async () => {
      hideErrors ??= this.distributedCacheOptions.hideErrors;
      try {
        await cache.removeMany(
          keyArray.map((k) => this.normalizeKey(k)),
          this.cancellationTokenProvider.fallbackToProvider(signal),
        );
      } catch (e) {
        if (hideErrors) {
          await this.handleException(e);
          return;
        }
        throw e;
      }
    };

    if (this.shouldConsiderUow(considerUow)) {
      const uowCache = this.getUnitOfWorkCache();
      for (const key of keyArray) uowCache.get(String(key))?.removeValue();
      this.unitOfWorkManager.current?.onCompleted(removeRealCache);
    } else {
      await removeRealCache();
    }
  }

  protected async handleException(e: unknown): Promise<void> {
    this.logger.logException(e, LogLevel.Warning);
    await using scope = this.serviceScopeFactory.createScope();
    await scope.serviceProvider.getRequired(IExceptionNotifier).notify(new ExceptionNotificationContext(e, LogLevel.Warning));
  }

  protected toCacheItems(itemBytes: readonly (CacheValue | undefined)[], itemKeys: readonly TCacheKey[]): KeyValuePair<TCacheKey, TCacheItem | undefined>[] {
    if (itemBytes.length !== itemKeys.length) throw new AbpException("count of the item bytes should be same with the count of the given keys");
    return itemKeys.map((key, i) => ({ key, value: this.toCacheItem(itemBytes[i]) }));
  }

  protected toCacheItem(bytes: CacheValue | undefined): TCacheItem | undefined {
    if (bytes === undefined) return undefined;
    return this.serializer.deserialize<TCacheItem>(bytes, this.cacheItemType);
  }

  protected toRawCacheItems(items: readonly KeyValuePair<TCacheKey, TCacheItem>[]): { key: string; value: CacheValue }[] {
    return items.map((i) => ({ key: this.normalizeKey(i.key), value: this.serializer.serialize(i.value) }));
  }

  private static toCacheItemsWithDefaultValues<TKey, TItem>(keys: readonly TKey[]): KeyValuePair<TKey, TItem | undefined>[] {
    return keys.map((key) => ({ key, value: undefined }));
  }

  protected shouldConsiderUow(considerUow: boolean): boolean {
    return considerUow && this.unitOfWorkManager.current !== undefined;
  }

  protected getUnitOfWorkCacheKey(): string {
    return DistributedCache.UowCacheName + this.cacheName;
  }

  /** Pending items of the current unit of work, keyed by `String(key)` (object keys compare by their `toString()`). */
  protected getUnitOfWorkCache(): UowCache<TCacheItem> {
    const current = this.unitOfWorkManager.current;
    if (!current) throw new AbpException("There is no active UOW.");
    return getOrAddItem<UowCache<TCacheItem>>(current, this.getUnitOfWorkCacheKey(), () => new Map());
  }

  private setUnitOfWorkValue(key: TCacheKey, value: TCacheItem): void {
    const uowCache = this.getUnitOfWorkCache();
    const item = uowCache.get(String(key));
    if (item) item.setValue(value);
    else uowCache.set(String(key), new UnitOfWorkCacheItem(value));
  }
}
