import { createHash } from "node:crypto";
import { AbpException, Guid, IApplicationInfoAccessor, ICancellationTokenProvider, Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpDistributedCacheOptions, IDistributedCacheStore } from "@abp/caching";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { AbpSettingOptions, IStaticSettingDefinitionStore } from "@abp/settings";
import { IUnitOfWorkManager, UnitOfWork } from "@abp/uow";
import { getCachedString, setCachedString } from "./distributed-string-cache.js";
import { ISettingDefinitionRecordRepository } from "./repositories.js";
import type { SettingDefinitionRecord } from "./setting-definition-record.js";
import { ISettingDefinitionSerializer } from "./setting-definition-serializer.js";

/** Port of `IStaticSettingSaver`. */
export interface IStaticSettingSaver {
  save(): Promise<void>;
}
export const IStaticSettingSaver = createToken<IStaticSettingSaver>("IStaticSettingSaver");

/** Port of `TimeSpan.FromMinutes(5)`: how long to wait for the common lock. */
const CommonLockTimeoutMs = 5 * 60 * 1000;

/**
 * Port of `StaticSettingSaver`: persists the statically defined settings as `SettingDefinitionRecord`s so other
 * applications can read them through the dynamic definition store. Skipped when another instance of the same
 * application holds the lock or when the hash of the definitions did not change since the last save.
 */
@Transient(IStaticSettingSaver)
export class StaticSettingSaver implements IStaticSettingSaver {
  static readonly inject = [IStaticSettingDefinitionStore, ISettingDefinitionRecordRepository, ISettingDefinitionSerializer, IDistributedCacheStore, optionsToken(AbpDistributedCacheOptions), IApplicationInfoAccessor, IAbpDistributedLock, optionsToken(AbpSettingOptions), ICancellationTokenProvider, IUnitOfWorkManager] as const;
  protected readonly settingOptions: AbpSettingOptions;
  protected readonly cacheOptions: AbpDistributedCacheOptions;

  constructor(
    protected readonly staticStore: IStaticSettingDefinitionStore,
    protected readonly settingRepository: ISettingDefinitionRecordRepository,
    protected readonly settingSerializer: ISettingDefinitionSerializer,
    protected readonly cache: IDistributedCacheStore,
    cacheOptions: IOptions<AbpDistributedCacheOptions>,
    protected readonly applicationInfoAccessor: IApplicationInfoAccessor,
    protected readonly distributedLock: IAbpDistributedLock,
    settingOptions: IOptions<AbpSettingOptions>,
    protected readonly cancellationTokenProvider: ICancellationTokenProvider,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
  ) {
    this.settingOptions = settingOptions.value;
    this.cacheOptions = cacheOptions.value;
  }

  @UnitOfWork()
  async save(): Promise<void> {
    await using applicationLockHandle = await this.distributedLock.tryAcquire(this.getApplicationDistributedLockKey());
    if (applicationLockHandle === undefined) return;

    const signal = this.cancellationTokenProvider.signal;
    const cacheKey = this.getApplicationHashCacheKey();
    const cachedHash = await getCachedString(this.cache, cacheKey, signal);

    const settingRecords = await this.settingSerializer.serializeMany(await this.staticStore.getAll());
    const currentHash = this.calculateHash(settingRecords, this.settingOptions.deletedSettings);
    if (cachedHash === currentHash) return;

    {
      await using commonLockHandle = await this.distributedLock.tryAcquire(this.getCommonDistributedLockKey(), CommonLockTimeoutMs);
      if (commonLockHandle === undefined) throw new AbpException("Could not acquire distributed lock for saving static Settings!");

      const unitOfWork = this.unitOfWorkManager.begin({ isTransactional: true }, true);
      try {
        const hasChangesInSettings = await this.updateChangedSettings(settingRecords);
        if (hasChangesInSettings) await setCachedString(this.cache, this.getCommonStampCacheKey(), Guid.newGuid(), signal);
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

  private async updateChangedSettings(settingRecords: readonly SettingDefinitionRecord[]): Promise<boolean> {
    const newRecords: SettingDefinitionRecord[] = [];
    const changedRecords: SettingDefinitionRecord[] = [];
    const settingRecordsInDatabase = new Map((await this.settingRepository.getList()).map((x) => [x.name, x]));

    for (const record of settingRecords) {
      const settingRecordInDatabase = settingRecordsInDatabase.get(record.name);
      if (settingRecordInDatabase === undefined) {
        newRecords.push(record);
        continue;
      }
      if (record.hasSameData(settingRecordInDatabase)) continue;
      settingRecordInDatabase.patch(record);
      changedRecords.push(settingRecordInDatabase);
    }

    const deletedRecords = this.settingOptions.deletedSettings.size > 0 ? [...settingRecordsInDatabase.values()].filter((x) => this.settingOptions.deletedSettings.has(x.name)) : [];

    if (newRecords.length > 0) await this.settingRepository.insertMany(newRecords);
    if (changedRecords.length > 0) await this.settingRepository.updateMany(changedRecords);
    if (deletedRecords.length > 0) await this.settingRepository.deleteMany(deletedRecords);

    return newRecords.length > 0 || changedRecords.length > 0 || deletedRecords.length > 0;
  }

  private getApplicationDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_${this.applicationInfoAccessor.applicationName ?? ""}_AbpSettingUpdateLock`;
  }

  private getCommonDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_Common_AbpSettingUpdateLock`;
  }

  private getApplicationHashCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_${this.applicationInfoAccessor.applicationName ?? ""}_AbpSettingsHash`;
  }

  private getCommonStampCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_AbpInMemorySettingCacheStamp`;
  }

  /** MD5 of the records (without their ids) and the deleted setting names, like .NET's `CalculateHash`. */
  private calculateHash(settingRecords: readonly SettingDefinitionRecord[], deletedSettings: ReadonlySet<string>): string {
    const records = settingRecords.map(({ name, displayName, description, defaultValue, isVisibleToClients, providers, isInherited, isEncrypted, extraProperties }) => ({
      name,
      displayName,
      description: description ?? null,
      defaultValue: defaultValue ?? null,
      isVisibleToClients,
      providers: providers ?? null,
      isInherited,
      isEncrypted,
      extraProperties: extraProperties.toObject(),
    }));
    const text = `SettingRecords:${JSON.stringify(records)}\nDeletedSetting:${[...deletedSettings].join(",")}`;
    return createHash("md5").update(text).digest("hex");
  }
}
