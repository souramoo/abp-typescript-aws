import { AbpException, AsyncLock, Dependency, Guid, Singleton, Transient, createToken, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { AbpDistributedCacheOptions, IDistributedCacheStore } from "@abp/caching";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { ILocalizableStringSerializer } from "@abp/localization";
import { IDynamicSettingDefinitionStore, SettingDefinition } from "@abp/settings";
import { getCachedString, setCachedString } from "./distributed-string-cache.js";
import { ISettingDefinitionRecordRepository } from "./repositories.js";
import type { SettingDefinitionRecord } from "./setting-definition-record.js";
import { SettingManagementOptions } from "./setting-management-options.js";

/** Port of `IDynamicSettingDefinitionStoreInMemoryCache`. */
export interface IDynamicSettingDefinitionStoreInMemoryCache {
  cacheStamp: string | undefined;
  readonly syncSemaphore: AsyncLock;
  lastCheckTime: Date | undefined;
  fill(settingRecords: readonly SettingDefinitionRecord[]): Promise<void>;
  getSettingOrNull(name: string): SettingDefinition | undefined;
  getSettings(): readonly SettingDefinition[];
}
export const IDynamicSettingDefinitionStoreInMemoryCache = createToken<IDynamicSettingDefinitionStoreInMemoryCache>("IDynamicSettingDefinitionStoreInMemoryCache");

/** Port of `DynamicSettingDefinitionStoreInMemoryCache`: the process-wide copy of the persisted definitions. */
@Singleton(IDynamicSettingDefinitionStoreInMemoryCache)
export class DynamicSettingDefinitionStoreInMemoryCache implements IDynamicSettingDefinitionStoreInMemoryCache {
  static readonly inject = [ILocalizableStringSerializer] as const;
  cacheStamp: string | undefined = undefined;
  lastCheckTime: Date | undefined = undefined;
  readonly syncSemaphore = new AsyncLock();
  protected readonly settingDefinitions = new Map<string, SettingDefinition>();

  constructor(protected readonly localizableStringSerializer: ILocalizableStringSerializer) {}

  async fill(settingRecords: readonly SettingDefinitionRecord[]): Promise<void> {
    this.settingDefinitions.clear();
    for (const record of settingRecords) {
      const settingDefinition = new SettingDefinition(
        record.name,
        record.defaultValue,
        this.localizableStringSerializer.deserialize(record.displayName),
        record.description === undefined ? undefined : this.localizableStringSerializer.deserialize(record.description),
        record.isVisibleToClients,
        record.isInherited,
        record.isEncrypted,
      );
      if (!isNullOrWhiteSpace(record.providers)) settingDefinition.withProviders(...record.providers.split(","));
      for (const [key, value] of record.extraProperties) settingDefinition.withProperty(key, value);
      this.settingDefinitions.set(record.name, settingDefinition);
    }
  }

  getSettingOrNull(name: string): SettingDefinition | undefined {
    return this.settingDefinitions.get(name);
  }

  getSettings(): readonly SettingDefinition[] {
    return [...this.settingDefinitions.values()];
  }
}

/** Port of `TimeSpan.FromMinutes(2)`: how long to wait for the common lock while creating the stamp. */
const CommonLockTimeoutMs = 2 * 60 * 1000;
/** The in-memory cache is re-validated against the distributed stamp at most every 30 seconds. */
const CacheCheckIntervalMs = 30 * 1000;

/**
 * Port of `DynamicSettingDefinitionStore`: definitions saved by other applications (`StaticSettingSaver`), served
 * from an in-memory cache that is refreshed when the distributed stamp changes. Replaces `NullDynamicSettingDefinitionStore`.
 */
@Dependency({ replaceServices: true })
@Transient(IDynamicSettingDefinitionStore)
export class DynamicSettingDefinitionStore implements IDynamicSettingDefinitionStore {
  static readonly inject = [ISettingDefinitionRecordRepository, IDynamicSettingDefinitionStoreInMemoryCache, IDistributedCacheStore, optionsToken(AbpDistributedCacheOptions), optionsToken(SettingManagementOptions), IAbpDistributedLock] as const;
  readonly settingManagementOptions: SettingManagementOptions;
  protected readonly cacheOptions: AbpDistributedCacheOptions;

  constructor(
    protected readonly settingRepository: ISettingDefinitionRecordRepository,
    protected readonly storeCache: IDynamicSettingDefinitionStoreInMemoryCache,
    protected readonly distributedCache: IDistributedCacheStore,
    cacheOptions: IOptions<AbpDistributedCacheOptions>,
    settingManagementOptions: IOptions<SettingManagementOptions>,
    protected readonly distributedLock: IAbpDistributedLock,
  ) {
    this.settingManagementOptions = settingManagementOptions.value;
    this.cacheOptions = cacheOptions.value;
  }

  async get(name: string): Promise<SettingDefinition> {
    const setting = await this.getOrNull(name);
    if (!setting) throw new AbpException(`Undefined setting: ${name}`);
    return setting;
  }

  async getOrNull(name: string): Promise<SettingDefinition | undefined> {
    if (!this.settingManagementOptions.isDynamicSettingStoreEnabled) return undefined;
    return this.storeCache.syncSemaphore.lock(async () => {
      await this.ensureCacheIsUpToDate();
      return this.storeCache.getSettingOrNull(name);
    });
  }

  async getAll(): Promise<readonly SettingDefinition[]> {
    if (!this.settingManagementOptions.isDynamicSettingStoreEnabled) return [];
    return this.storeCache.syncSemaphore.lock(async () => {
      await this.ensureCacheIsUpToDate();
      return this.storeCache.getSettings();
    });
  }

  protected async ensureCacheIsUpToDate(): Promise<void> {
    if (this.storeCache.lastCheckTime !== undefined && Date.now() - this.storeCache.lastCheckTime.getTime() < CacheCheckIntervalMs) return;

    const stampInDistributedCache = await this.getOrSetStampInDistributedCache();
    if (stampInDistributedCache === this.storeCache.cacheStamp) {
      this.storeCache.lastCheckTime = new Date();
      return;
    }

    await this.updateInMemoryStoreCache();
    this.storeCache.cacheStamp = stampInDistributedCache;
    this.storeCache.lastCheckTime = new Date();
  }

  protected async updateInMemoryStoreCache(): Promise<void> {
    await this.storeCache.fill(await this.settingRepository.getList());
  }

  protected async getOrSetStampInDistributedCache(): Promise<string> {
    const cacheKey = this.getCommonStampCacheKey();
    const existing = await getCachedString(this.distributedCache, cacheKey);
    if (existing !== undefined) return existing;

    await using commonLockHandle = await this.distributedLock.tryAcquire(this.getCommonDistributedLockKey(), CommonLockTimeoutMs);
    if (commonLockHandle === undefined) throw new AbpException("Could not acquire distributed lock for setting definition common stamp check!");

    const stamp = (await getCachedString(this.distributedCache, cacheKey)) ?? Guid.newGuid();
    await setCachedString(this.distributedCache, cacheKey, stamp);
    return stamp;
  }

  protected getCommonStampCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_AbpInMemorySettingCacheStamp`;
  }

  protected getCommonDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_Common_AbpSettingUpdateLock`;
  }
}
