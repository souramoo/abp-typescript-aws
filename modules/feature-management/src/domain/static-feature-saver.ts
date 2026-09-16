import { createHash } from "node:crypto";
import { AbpException, Guid, IApplicationInfoAccessor, ICancellationTokenProvider, Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpDistributedCacheOptions, IDistributedCacheStore } from "@abp/caching";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { AbpFeatureOptions, IStaticFeatureDefinitionStore } from "@abp/features";
import { IUnitOfWorkManager } from "@abp/uow";
import { getCachedString, setCachedString } from "./distributed-string-cache.js";
import { IFeatureDefinitionSerializer } from "./feature-definition-serializer.js";
import type { FeatureDefinitionRecord, FeatureGroupDefinitionRecord } from "./feature-definition-records.js";
import { IFeatureDefinitionRecordRepository, IFeatureGroupDefinitionRecordRepository } from "./repositories.js";

/** Port of `IStaticFeatureSaver`. */
export interface IStaticFeatureSaver {
  save(): Promise<void>;
}
export const IStaticFeatureSaver = createToken<IStaticFeatureSaver>("IStaticFeatureSaver");

/** Port of `TimeSpan.FromMinutes(5)`: how long to wait for the common lock. */
const CommonLockTimeoutMs = 5 * 60 * 1000;

/**
 * Port of `StaticFeatureSaver`: persists the statically defined feature groups and features as records so other
 * applications can read them through the dynamic definition store. Skipped when another instance of the same
 * application holds the lock or when the hash of the definitions did not change since the last save.
 */
@Transient(IStaticFeatureSaver)
export class StaticFeatureSaver implements IStaticFeatureSaver {
  static readonly inject = [IStaticFeatureDefinitionStore, IFeatureGroupDefinitionRecordRepository, IFeatureDefinitionRecordRepository, IFeatureDefinitionSerializer, IDistributedCacheStore, optionsToken(AbpDistributedCacheOptions), IApplicationInfoAccessor, IAbpDistributedLock, optionsToken(AbpFeatureOptions), ICancellationTokenProvider, IUnitOfWorkManager] as const;
  protected readonly featureOptions: AbpFeatureOptions;
  protected readonly cacheOptions: AbpDistributedCacheOptions;

  constructor(
    protected readonly staticStore: IStaticFeatureDefinitionStore,
    protected readonly featureGroupRepository: IFeatureGroupDefinitionRecordRepository,
    protected readonly featureRepository: IFeatureDefinitionRecordRepository,
    protected readonly featureSerializer: IFeatureDefinitionSerializer,
    protected readonly cache: IDistributedCacheStore,
    cacheOptions: IOptions<AbpDistributedCacheOptions>,
    protected readonly applicationInfoAccessor: IApplicationInfoAccessor,
    protected readonly distributedLock: IAbpDistributedLock,
    featureOptions: IOptions<AbpFeatureOptions>,
    protected readonly cancellationTokenProvider: ICancellationTokenProvider,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
  ) {
    this.featureOptions = featureOptions.value;
    this.cacheOptions = cacheOptions.value;
  }

  async save(): Promise<void> {
    await using applicationLockHandle = await this.distributedLock.tryAcquire(this.getApplicationDistributedLockKey());
    if (applicationLockHandle === undefined) return;

    const signal = this.cancellationTokenProvider.signal;
    const cacheKey = this.getApplicationHashCacheKey();
    const cachedHash = await getCachedString(this.cache, cacheKey, signal);

    const [featureGroupRecords, featureRecords] = await this.featureSerializer.serializeGroups(await this.staticStore.getGroups());
    const currentHash = this.calculateHash(featureGroupRecords, featureRecords, this.featureOptions.deletedFeatureGroups, this.featureOptions.deletedFeatures);
    if (cachedHash === currentHash) return;

    {
      await using commonLockHandle = await this.distributedLock.tryAcquire(this.getCommonDistributedLockKey(), CommonLockTimeoutMs);
      if (commonLockHandle === undefined) throw new AbpException("Could not acquire distributed lock for saving static features!");

      const unitOfWork = this.unitOfWorkManager.begin({ isTransactional: true }, true);
      try {
        const hasChangesInGroups = await this.updateChangedFeatureGroups(featureGroupRecords);
        const hasChangesInFeatures = await this.updateChangedFeatures(featureRecords);
        if (hasChangesInGroups || hasChangesInFeatures) await setCachedString(this.cache, this.getCommonStampCacheKey(), Guid.newGuid(), signal);
        await unitOfWork.complete();
      } catch (e) {
        try {
          await unitOfWork.rollback();
        } catch {
          /* ignored */
        }
        throw e;
      } finally {
        await unitOfWork.dispose();
      }
    }

    await setCachedString(this.cache, cacheKey, currentHash, signal);
  }

  private async updateChangedFeatureGroups(featureGroupRecords: readonly FeatureGroupDefinitionRecord[]): Promise<boolean> {
    const newRecords: FeatureGroupDefinitionRecord[] = [];
    const changedRecords: FeatureGroupDefinitionRecord[] = [];
    const featureGroupRecordsInDatabase = new Map((await this.featureGroupRepository.getList()).map((x) => [x.name, x]));

    for (const featureGroupRecord of featureGroupRecords) {
      const featureGroupRecordInDatabase = featureGroupRecordsInDatabase.get(featureGroupRecord.name);
      if (featureGroupRecordInDatabase === undefined) {
        newRecords.push(featureGroupRecord);
        continue;
      }
      if (featureGroupRecord.hasSameData(featureGroupRecordInDatabase)) continue;
      featureGroupRecordInDatabase.patch(featureGroupRecord);
      changedRecords.push(featureGroupRecordInDatabase);
    }

    const deletedRecords = this.featureOptions.deletedFeatureGroups.size > 0 ? [...featureGroupRecordsInDatabase.values()].filter((x) => this.featureOptions.deletedFeatureGroups.has(x.name)) : [];

    if (newRecords.length > 0) await this.featureGroupRepository.insertMany(newRecords);
    if (changedRecords.length > 0) await this.featureGroupRepository.updateMany(changedRecords);
    if (deletedRecords.length > 0) await this.featureGroupRepository.deleteMany(deletedRecords);

    return newRecords.length > 0 || changedRecords.length > 0 || deletedRecords.length > 0;
  }

  private async updateChangedFeatures(featureRecords: readonly FeatureDefinitionRecord[]): Promise<boolean> {
    const newRecords: FeatureDefinitionRecord[] = [];
    const changedRecords: FeatureDefinitionRecord[] = [];
    const featureRecordsInDatabase = new Map((await this.featureRepository.getList()).map((x) => [x.name, x]));

    for (const featureRecord of featureRecords) {
      const featureRecordInDatabase = featureRecordsInDatabase.get(featureRecord.name);
      if (featureRecordInDatabase === undefined) {
        newRecords.push(featureRecord);
        continue;
      }
      if (featureRecord.hasSameData(featureRecordInDatabase)) continue;
      featureRecordInDatabase.patch(featureRecord);
      changedRecords.push(featureRecordInDatabase);
    }

    const deletedRecords: FeatureDefinitionRecord[] = [];
    for (const record of featureRecordsInDatabase.values()) {
      if (this.featureOptions.deletedFeatures.has(record.name) || this.featureOptions.deletedFeatureGroups.has(record.groupName)) deletedRecords.push(record);
    }

    if (newRecords.length > 0) await this.featureRepository.insertMany(newRecords);
    if (changedRecords.length > 0) await this.featureRepository.updateMany(changedRecords);
    if (deletedRecords.length > 0) await this.featureRepository.deleteMany(deletedRecords);

    return newRecords.length > 0 || changedRecords.length > 0 || deletedRecords.length > 0;
  }

  private getApplicationDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_${this.applicationInfoAccessor.applicationName ?? ""}_AbpFeatureUpdateLock`;
  }

  private getCommonDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_Common_AbpFeatureUpdateLock`;
  }

  private getApplicationHashCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_${this.applicationInfoAccessor.applicationName ?? ""}_AbpFeaturesHash`;
  }

  private getCommonStampCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_AbpInMemoryFeatureCacheStamp`;
  }

  /** MD5 of the records (without their ids) and the deleted names, like .NET's `CalculateHash`. */
  private calculateHash(featureGroupRecords: readonly FeatureGroupDefinitionRecord[], featureRecords: readonly FeatureDefinitionRecord[], deletedFeatureGroups: ReadonlySet<string>, deletedFeatures: ReadonlySet<string>): string {
    const groups = featureGroupRecords.map(({ name, displayName, extraProperties }) => ({ name, displayName, extraProperties: extraProperties.toObject() }));
    const features = featureRecords.map(({ groupName, name, parentName, displayName, description, defaultValue, isVisibleToClients, isAvailableToHost, allowedProviders, valueType, extraProperties }) => ({
      groupName,
      name,
      parentName: parentName ?? null,
      displayName,
      description: description ?? null,
      defaultValue: defaultValue ?? null,
      isVisibleToClients,
      isAvailableToHost,
      allowedProviders: allowedProviders ?? null,
      valueType,
      extraProperties: extraProperties.toObject(),
    }));
    const text = `FeatureGroupRecords:${JSON.stringify(groups)}\nFeatureRecords:${JSON.stringify(features)}\nDeletedFeatureGroups:${[...deletedFeatureGroups].join(",")}\nDeletedFeature:${[...deletedFeatures].join(",")}`;
    return createHash("md5").update(text).digest("hex");
  }
}
