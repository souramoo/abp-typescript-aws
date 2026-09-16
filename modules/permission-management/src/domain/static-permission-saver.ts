import { createHash } from "node:crypto";
import { AbpException, Guid, IApplicationInfoAccessor, ICancellationTokenProvider, Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpPermissionOptions, IStaticPermissionDefinitionStore } from "@abp/authorization";
import { AbpDistributedCacheOptions, DistributedCacheEntryOptions, IDistributedCacheStore, type CacheValue } from "@abp/caching";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { IDistributedEventBus } from "@abp/event-bus";
import { IUnitOfWorkManager } from "@abp/uow";
import { DynamicPermissionDefinitionsChangedEto } from "../domain-shared/index.js";
import { IPermissionDefinitionRecordRepository, IPermissionGroupDefinitionRecordRepository, type PermissionDefinitionRecord, type PermissionGroupDefinitionRecord } from "./permission-definition-records.js";
import { IPermissionDefinitionSerializer } from "./permission-definition-serializer.js";

/** Port of `IStaticPermissionSaver`. */
export interface IStaticPermissionSaver {
  save(): Promise<void>;
}
export const IStaticPermissionSaver = createToken<IStaticPermissionSaver>("IStaticPermissionSaver");

/** Sliding expiration of the hash/stamp cache entries (`TimeSpan.FromDays(30)` in .NET). */
const CacheEntryLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const CommonLockTimeoutMs = 5 * 60 * 1000;

function cacheValueToString(value: CacheValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

/**
 * Port of `StaticPermissionSaver`: writes the statically defined permission groups/permissions to the database when
 * their hash changed since the last run of this application (application-scoped hash + common stamp in the
 * distributed cache, guarded by distributed locks like .NET).
 */
@Transient(IStaticPermissionSaver)
export class StaticPermissionSaver implements IStaticPermissionSaver {
  static readonly inject = [
    IStaticPermissionDefinitionStore,
    IPermissionGroupDefinitionRecordRepository,
    IPermissionDefinitionRecordRepository,
    IPermissionDefinitionSerializer,
    IDistributedCacheStore,
    optionsToken(AbpDistributedCacheOptions),
    IApplicationInfoAccessor,
    IAbpDistributedLock,
    optionsToken(AbpPermissionOptions),
    ICancellationTokenProvider,
    IUnitOfWorkManager,
    IDistributedEventBus,
  ] as const;
  protected readonly cacheOptions: AbpDistributedCacheOptions;
  protected readonly permissionOptions: AbpPermissionOptions;

  constructor(
    protected readonly staticStore: IStaticPermissionDefinitionStore,
    protected readonly permissionGroupRepository: IPermissionGroupDefinitionRecordRepository,
    protected readonly permissionRepository: IPermissionDefinitionRecordRepository,
    protected readonly permissionSerializer: IPermissionDefinitionSerializer,
    protected readonly cache: IDistributedCacheStore,
    cacheOptions: IOptions<AbpDistributedCacheOptions>,
    protected readonly applicationInfoAccessor: IApplicationInfoAccessor,
    protected readonly distributedLock: IAbpDistributedLock,
    permissionOptions: IOptions<AbpPermissionOptions>,
    protected readonly cancellationTokenProvider: ICancellationTokenProvider,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    protected readonly distributedEventBus: IDistributedEventBus,
  ) {
    this.cacheOptions = cacheOptions.value;
    this.permissionOptions = permissionOptions.value;
  }

  async save(): Promise<void> {
    await using applicationLockHandle = await this.distributedLock.tryAcquire(this.getApplicationDistributedLockKey());
    /* Another application instance is already doing it */
    if (!applicationLockHandle) return;

    const signal = this.cancellationTokenProvider.signal;
    const cacheKey = this.getApplicationHashCacheKey();
    const cachedHash = cacheValueToString(await this.cache.get(cacheKey, signal));

    const { groupRecords, permissionRecords: groupedPermissionRecords } = await this.permissionSerializer.serializeGroups(await this.staticStore.getGroups());
    const resourcePermissions = await this.permissionSerializer.serializePermissions(await this.staticStore.getResourcePermissions());
    const permissionRecords = [...groupedPermissionRecords, ...resourcePermissions];

    const currentHash = calculateHash(groupRecords, permissionRecords, this.permissionOptions.deletedPermissionGroups, this.permissionOptions.deletedPermissions);
    if (cachedHash === currentHash) return;

    {
      await using commonLockHandle = await this.distributedLock.tryAcquire(this.getCommonDistributedLockKey(), CommonLockTimeoutMs);
      /* It will re-try */
      if (!commonLockHandle) throw new AbpException("Could not acquire distributed lock for saving static permissions!");

      const newOrChangedPermissions: string[] = [];
      const unitOfWork = this.unitOfWorkManager.begin({ isTransactional: true }, true);
      try {
        try {
          const hasChangesInGroups = await this.updateChangedPermissionGroups(groupRecords);
          const hasChangesInPermissions = await this.updateChangedPermissions(permissionRecords, newOrChangedPermissions);
          if (hasChangesInGroups || hasChangesInPermissions) {
            await this.cache.set(this.getCommonStampCacheKey(), Guid.newGuid(), new DistributedCacheEntryOptions({ slidingExpiration: CacheEntryLifetimeMs }), signal);
          }
        } catch (e) {
          try {
            await unitOfWork.rollback();
          } catch {
            /* ignored */
          }
          throw e;
        }

        if (newOrChangedPermissions.length > 0) {
          await this.distributedEventBus.publish(new DynamicPermissionDefinitionsChangedEto([...new Set(newOrChangedPermissions)]));
        }
        await unitOfWork.complete();
      } finally {
        await unitOfWork.dispose();
      }
    }

    await this.cache.set(cacheKey, currentHash, new DistributedCacheEntryOptions({ slidingExpiration: CacheEntryLifetimeMs }), signal);
  }

  private async updateChangedPermissionGroups(permissionGroupRecords: readonly PermissionGroupDefinitionRecord[]): Promise<boolean> {
    const newRecords: PermissionGroupDefinitionRecord[] = [];
    const changedRecords: PermissionGroupDefinitionRecord[] = [];
    const inDatabase = new Map((await this.permissionGroupRepository.getList()).map((x) => [x.name, x]));

    for (const record of permissionGroupRecords) {
      const existing = inDatabase.get(record.name);
      if (!existing) {
        newRecords.push(record);
        continue;
      }
      if (record.hasSameData(existing)) continue;
      existing.patch(record);
      changedRecords.push(existing);
    }

    const deletedRecords = this.permissionOptions.deletedPermissionGroups.size > 0 ? [...inDatabase.values()].filter((x) => this.permissionOptions.deletedPermissionGroups.has(x.name)) : [];

    if (newRecords.length > 0) await this.permissionGroupRepository.insertMany(newRecords);
    if (changedRecords.length > 0) await this.permissionGroupRepository.updateMany(changedRecords);
    if (deletedRecords.length > 0) await this.permissionGroupRepository.deleteMany(deletedRecords);
    return newRecords.length > 0 || changedRecords.length > 0 || deletedRecords.length > 0;
  }

  private async updateChangedPermissions(permissionRecords: readonly PermissionDefinitionRecord[], newOrChangedPermissions: string[]): Promise<boolean> {
    const newRecords: PermissionDefinitionRecord[] = [];
    const changedRecords: PermissionDefinitionRecord[] = [];
    const inDatabase = new Map((await this.permissionRepository.getList()).map((x) => [x.name, x]));

    for (const record of permissionRecords) {
      const existing = inDatabase.get(record.name);
      if (!existing) {
        newRecords.push(record);
        continue;
      }
      if (record.hasSameData(existing)) continue;
      existing.patch(record);
      changedRecords.push(existing);
    }

    const deletedRecords: PermissionDefinitionRecord[] = [];
    if (this.permissionOptions.deletedPermissions.size > 0) {
      deletedRecords.push(...[...inDatabase.values()].filter((x) => this.permissionOptions.deletedPermissions.has(x.name)));
    }
    if (this.permissionOptions.deletedPermissionGroups.size > 0) {
      for (const record of [...inDatabase.values()].filter((x) => x.groupName !== undefined && this.permissionOptions.deletedPermissionGroups.has(x.groupName))) {
        if (!deletedRecords.includes(record)) deletedRecords.push(record);
      }
    }

    if (newRecords.length > 0) {
      newOrChangedPermissions.push(...newRecords.map((x) => x.name));
      await this.permissionRepository.insertMany(newRecords);
    }
    if (changedRecords.length > 0) {
      newOrChangedPermissions.push(...changedRecords.map((x) => x.name));
      await this.permissionRepository.updateMany(changedRecords);
    }
    if (deletedRecords.length > 0) await this.permissionRepository.deleteMany(deletedRecords);
    return newRecords.length > 0 || changedRecords.length > 0 || deletedRecords.length > 0;
  }

  private getApplicationDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_${this.applicationInfoAccessor.applicationName ?? ""}_AbpPermissionUpdateLock`;
  }

  private getCommonDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_Common_AbpPermissionUpdateLock`;
  }

  private getApplicationHashCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_${this.applicationInfoAccessor.applicationName ?? ""}_AbpPermissionsHash`;
  }

  private getCommonStampCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_AbpInMemoryPermissionCacheStamp`;
  }
}

/** Port of `CalculateHash`: MD5 of the records (without their ids) and the deleted names. */
function calculateHash(permissionGroupRecords: readonly PermissionGroupDefinitionRecord[], permissionRecords: readonly PermissionDefinitionRecord[], deletedPermissionGroups: Iterable<string>, deletedPermissions: Iterable<string>): string {
  const withoutId = (record: object): Record<string, unknown> => {
    const plain: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "id" || typeof value === "function") continue;
      plain[key] = value instanceof Map ? Object.fromEntries(value) : value;
    }
    return plain;
  };
  const text = [`PermissionGroupRecords:${JSON.stringify(permissionGroupRecords.map(withoutId))}`, `PermissionRecords:${JSON.stringify(permissionRecords.map(withoutId))}`, `DeletedPermissionGroups:${[...deletedPermissionGroups].join(",")}`, `DeletedPermission:${[...deletedPermissions].join(",")}`].join("\n");
  return createHash("md5").update(text).digest("hex");
}
