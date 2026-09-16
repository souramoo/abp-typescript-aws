import { AbpException, AsyncLock, Dependency, Guid, Singleton, Transient, createToken, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { AbpDistributedCacheOptions, IDistributedCacheStore } from "@abp/caching";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { FeatureDefinitionContext, IDynamicFeatureDefinitionStore, type FeatureDefinition, type FeatureGroupDefinition, type ICanCreateChildFeature } from "@abp/features";
import { ILocalizableStringSerializer } from "@abp/localization";
import { getCachedString, setCachedString } from "./distributed-string-cache.js";
import type { FeatureDefinitionRecord, FeatureGroupDefinitionRecord } from "./feature-definition-records.js";
import { FeatureManagementOptions } from "./feature-management-options.js";
import { IFeatureDefinitionRecordRepository, IFeatureGroupDefinitionRecordRepository } from "./repositories.js";
import { StringValueTypeSerializer } from "./string-value-type-serializer.js";

/** Port of `IDynamicFeatureDefinitionStoreInMemoryCache`. */
export interface IDynamicFeatureDefinitionStoreInMemoryCache {
  cacheStamp: string | undefined;
  readonly syncSemaphore: AsyncLock;
  lastCheckTime: Date | undefined;
  fill(featureGroupRecords: readonly FeatureGroupDefinitionRecord[], featureRecords: readonly FeatureDefinitionRecord[]): Promise<void>;
  getFeatureOrNull(name: string): FeatureDefinition | undefined;
  getFeatures(): readonly FeatureDefinition[];
  getGroups(): readonly FeatureGroupDefinition[];
}
export const IDynamicFeatureDefinitionStoreInMemoryCache = createToken<IDynamicFeatureDefinitionStoreInMemoryCache>("IDynamicFeatureDefinitionStoreInMemoryCache");

/** Port of `DynamicFeatureDefinitionStoreInMemoryCache`: the process-wide copy of the persisted definitions. */
@Singleton(IDynamicFeatureDefinitionStoreInMemoryCache)
export class DynamicFeatureDefinitionStoreInMemoryCache implements IDynamicFeatureDefinitionStoreInMemoryCache {
  static readonly inject = [StringValueTypeSerializer, ILocalizableStringSerializer] as const;
  cacheStamp: string | undefined = undefined;
  lastCheckTime: Date | undefined = undefined;
  readonly syncSemaphore = new AsyncLock();
  protected readonly featureGroupDefinitions = new Map<string, FeatureGroupDefinition>();
  protected readonly featureDefinitions = new Map<string, FeatureDefinition>();

  constructor(
    protected readonly stateCheckerSerializer: StringValueTypeSerializer,
    protected readonly localizableStringSerializer: ILocalizableStringSerializer,
  ) {}

  async fill(featureGroupRecords: readonly FeatureGroupDefinitionRecord[], featureRecords: readonly FeatureDefinitionRecord[]): Promise<void> {
    this.featureGroupDefinitions.clear();
    this.featureDefinitions.clear();

    const context = new FeatureDefinitionContext();
    for (const featureGroupRecord of featureGroupRecords) {
      const featureGroup = context.addGroup(featureGroupRecord.name, this.localizableStringSerializer.deserialize(featureGroupRecord.displayName));
      this.featureGroupDefinitions.set(featureGroup.name, featureGroup);
      for (const [key, value] of featureGroupRecord.extraProperties) featureGroup.properties.set(key, value);

      const featureRecordsInThisGroup = featureRecords.filter((r) => r.groupName === featureGroup.name);
      for (const featureRecord of featureRecordsInThisGroup.filter((r) => r.parentName === undefined)) this.addFeatureRecursively(featureGroup, featureRecord, featureRecords);
    }
  }

  getFeatureOrNull(name: string): FeatureDefinition | undefined {
    return this.featureDefinitions.get(name);
  }

  getFeatures(): readonly FeatureDefinition[] {
    return [...this.featureDefinitions.values()];
  }

  getGroups(): readonly FeatureGroupDefinition[] {
    return [...this.featureGroupDefinitions.values()];
  }

  private addFeatureRecursively(featureContainer: ICanCreateChildFeature, featureRecord: FeatureDefinitionRecord, allFeatureRecords: readonly FeatureDefinitionRecord[]): void {
    const feature = featureContainer.createChildFeature(featureRecord.name, {
      defaultValue: featureRecord.defaultValue,
      displayName: this.localizableStringSerializer.deserialize(featureRecord.displayName),
      description: featureRecord.description === undefined ? undefined : this.localizableStringSerializer.deserialize(featureRecord.description),
      valueType: this.stateCheckerSerializer.deserialize(featureRecord.valueType),
      isVisibleToClients: featureRecord.isVisibleToClients,
      isAvailableToHost: featureRecord.isAvailableToHost,
    });
    this.featureDefinitions.set(feature.name, feature);

    if (!isNullOrWhiteSpace(featureRecord.allowedProviders)) feature.withProviders(...featureRecord.allowedProviders.split(","));
    for (const [key, value] of featureRecord.extraProperties) feature.properties.set(key, value);

    for (const subFeature of allFeatureRecords.filter((r) => r.parentName === featureRecord.name)) this.addFeatureRecursively(feature, subFeature, allFeatureRecords);
  }
}

/** Port of `TimeSpan.FromMinutes(2)`: how long to wait for the common lock while creating the stamp. */
const CommonLockTimeoutMs = 2 * 60 * 1000;
/** The in-memory cache is re-validated against the distributed stamp at most every 30 seconds. */
const CacheCheckIntervalMs = 30 * 1000;

/**
 * Port of `DynamicFeatureDefinitionStore`: definitions saved by other applications (`StaticFeatureSaver`), served
 * from an in-memory cache that is refreshed when the distributed stamp changes. Replaces `NullDynamicFeatureDefinitionStore`.
 */
@Dependency({ replaceServices: true })
@Transient(IDynamicFeatureDefinitionStore)
export class DynamicFeatureDefinitionStore implements IDynamicFeatureDefinitionStore {
  static readonly inject = [IFeatureGroupDefinitionRecordRepository, IFeatureDefinitionRecordRepository, IDynamicFeatureDefinitionStoreInMemoryCache, IDistributedCacheStore, optionsToken(AbpDistributedCacheOptions), optionsToken(FeatureManagementOptions), IAbpDistributedLock] as const;
  readonly featureManagementOptions: FeatureManagementOptions;
  protected readonly cacheOptions: AbpDistributedCacheOptions;

  constructor(
    protected readonly featureGroupRepository: IFeatureGroupDefinitionRecordRepository,
    protected readonly featureRepository: IFeatureDefinitionRecordRepository,
    protected readonly storeCache: IDynamicFeatureDefinitionStoreInMemoryCache,
    protected readonly distributedCache: IDistributedCacheStore,
    cacheOptions: IOptions<AbpDistributedCacheOptions>,
    featureManagementOptions: IOptions<FeatureManagementOptions>,
    protected readonly distributedLock: IAbpDistributedLock,
  ) {
    this.featureManagementOptions = featureManagementOptions.value;
    this.cacheOptions = cacheOptions.value;
  }

  async getOrNull(name: string): Promise<FeatureDefinition | undefined> {
    if (!this.featureManagementOptions.isDynamicFeatureStoreEnabled) return undefined;
    return this.storeCache.syncSemaphore.lock(async () => {
      await this.ensureCacheIsUpToDate();
      return this.storeCache.getFeatureOrNull(name);
    });
  }

  async getFeatures(): Promise<readonly FeatureDefinition[]> {
    if (!this.featureManagementOptions.isDynamicFeatureStoreEnabled) return [];
    return this.storeCache.syncSemaphore.lock(async () => {
      await this.ensureCacheIsUpToDate();
      return this.storeCache.getFeatures();
    });
  }

  async getGroups(): Promise<readonly FeatureGroupDefinition[]> {
    if (!this.featureManagementOptions.isDynamicFeatureStoreEnabled) return [];
    return this.storeCache.syncSemaphore.lock(async () => {
      await this.ensureCacheIsUpToDate();
      return this.storeCache.getGroups();
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
    const featureGroupRecords = await this.featureGroupRepository.getList();
    const featureRecords = await this.featureRepository.getList();
    await this.storeCache.fill(featureGroupRecords, featureRecords);
  }

  protected async getOrSetStampInDistributedCache(): Promise<string> {
    const cacheKey = this.getCommonStampCacheKey();
    const existing = await getCachedString(this.distributedCache, cacheKey);
    if (existing !== undefined) return existing;

    await using commonLockHandle = await this.distributedLock.tryAcquire(this.getCommonDistributedLockKey(), CommonLockTimeoutMs);
    if (commonLockHandle === undefined) throw new AbpException("Could not acquire distributed lock for feature definition common stamp check!");

    const stamp = (await getCachedString(this.distributedCache, cacheKey)) ?? Guid.newGuid();
    await setCachedString(this.distributedCache, cacheKey, stamp);
    return stamp;
  }

  protected getCommonStampCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_AbpInMemoryFeatureCacheStamp`;
  }

  protected getCommonDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_Common_AbpFeatureUpdateLock`;
  }
}
