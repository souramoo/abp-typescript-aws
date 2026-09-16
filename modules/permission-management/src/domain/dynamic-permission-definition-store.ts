import { AbpException, AsyncLock, Dependency, Guid, ServiceLifetime, Singleton, createToken, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { IDynamicPermissionDefinitionStore, PermissionDefinition, PermissionGroupDefinition, type ICanAddChildPermission } from "@abp/authorization";
import { AbpDistributedCacheOptions, DistributedCacheEntryOptions, IDistributedCacheStore, type CacheValue } from "@abp/caching";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { ILocalizableStringSerializer } from "@abp/localization";
import { IPermissionDefinitionRecordRepository, IPermissionGroupDefinitionRecordRepository, type PermissionDefinitionRecord, type PermissionGroupDefinitionRecord } from "./permission-definition-records.js";
import { PermissionManagementOptions } from "./permission-management-options.js";

/** The timings hard-coded in the .NET `DynamicPermissionDefinitionStore`, made configurable (milliseconds). */
export class AbpDynamicPermissionDefinitionStoreOptions {
  /** How long the in-memory cache is trusted before the distributed stamp is checked again. Default: 30 seconds. */
  cacheRefreshIntervalMs = 30_000;
  /** Sliding expiration of the common stamp in the distributed cache. Default: 30 days. */
  stampSlidingExpirationMs = 30 * 24 * 60 * 60 * 1000;
  /** How long to wait for the common lock when creating the stamp. Default: 2 minutes. */
  stampLockTimeoutMs = 2 * 60 * 1000;
}

/** Port of `IDynamicPermissionDefinitionStoreInMemoryCache`. */
export interface IDynamicPermissionDefinitionStoreInMemoryCache {
  cacheStamp: string | undefined;
  readonly syncSemaphore: AsyncLock;
  lastCheckTime: Date | undefined;
  fill(permissionGroupRecords: readonly PermissionGroupDefinitionRecord[], permissionRecords: readonly PermissionDefinitionRecord[]): Promise<void>;
  getPermissionOrNull(name: string): PermissionDefinition | undefined;
  getPermissions(): readonly PermissionDefinition[];
  getGroups(): readonly PermissionGroupDefinition[];
  getResourcePermissionOrNull(resourceName: string, name: string): PermissionDefinition | undefined;
  getResourcePermissions(): readonly PermissionDefinition[];
}
export const IDynamicPermissionDefinitionStoreInMemoryCache = createToken<IDynamicPermissionDefinitionStoreInMemoryCache>("IDynamicPermissionDefinitionStoreInMemoryCache");

/** Port of `DynamicPermissionDefinitionStoreInMemoryCache` (state checkers are not deserialized, see `PermissionDefinitionSerializer`). */
@Singleton(IDynamicPermissionDefinitionStoreInMemoryCache)
export class DynamicPermissionDefinitionStoreInMemoryCache implements IDynamicPermissionDefinitionStoreInMemoryCache {
  static readonly inject = [ILocalizableStringSerializer] as const;
  cacheStamp: string | undefined = undefined;
  readonly syncSemaphore = new AsyncLock();
  lastCheckTime: Date | undefined = undefined;
  protected readonly permissionGroupDefinitions = new Map<string, PermissionGroupDefinition>();
  protected readonly permissionDefinitions = new Map<string, PermissionDefinition>();
  protected readonly resourcePermissionDefinitions: PermissionDefinition[] = [];

  constructor(protected readonly localizableStringSerializer: ILocalizableStringSerializer) {}

  async fill(permissionGroupRecords: readonly PermissionGroupDefinitionRecord[], permissionRecords: readonly PermissionDefinitionRecord[]): Promise<void> {
    this.permissionGroupDefinitions.clear();
    this.permissionDefinitions.clear();
    this.resourcePermissionDefinitions.length = 0;

    for (const record of permissionRecords.filter((x) => !isNullOrWhiteSpace(x.resourceName))) {
      const resourcePermission = new PermissionDefinition(record.name, this.deserializeDisplayName(record.displayName), record.multiTenancySide, record.isEnabled, { resourceName: record.resourceName!, managementPermissionName: record.managementPermissionName ?? "" });
      this.applyPermissionProperties(resourcePermission, record);
      this.resourcePermissionDefinitions.push(resourcePermission);
    }

    const permissions = permissionRecords.filter((x) => isNullOrWhiteSpace(x.resourceName));
    for (const groupRecord of permissionGroupRecords) {
      const permissionGroup = new PermissionGroupDefinition(groupRecord.name, this.deserializeDisplayName(groupRecord.displayName));
      this.permissionGroupDefinitions.set(permissionGroup.name, permissionGroup);
      for (const [key, value] of groupRecord.extraProperties) permissionGroup.properties.set(key, value);

      const permissionRecordsInThisGroup = permissions.filter((p) => p.groupName === permissionGroup.name);
      for (const permissionRecord of permissionRecordsInThisGroup.filter((x) => x.parentName === undefined || x.parentName === null)) {
        this.addPermissionRecursively(permissionGroup, permissionRecord, permissions);
      }
    }
  }

  getPermissionOrNull(name: string): PermissionDefinition | undefined {
    return this.permissionDefinitions.get(name);
  }

  getPermissions(): readonly PermissionDefinition[] {
    return [...this.permissionDefinitions.values()];
  }

  getGroups(): readonly PermissionGroupDefinition[] {
    return [...this.permissionGroupDefinitions.values()];
  }

  getResourcePermissionOrNull(resourceName: string, name: string): PermissionDefinition | undefined {
    return this.resourcePermissionDefinitions.find((p) => p.resourceName === resourceName && p.name === name);
  }

  getResourcePermissions(): readonly PermissionDefinition[] {
    return [...this.resourcePermissionDefinitions];
  }

  private deserializeDisplayName(displayName: string | undefined): PermissionDefinition["displayName"] | undefined {
    return displayName === undefined || displayName === null ? undefined : this.localizableStringSerializer.deserialize(displayName);
  }

  private addPermissionRecursively(permissionContainer: ICanAddChildPermission, permissionRecord: PermissionDefinitionRecord, allPermissionRecords: readonly PermissionDefinitionRecord[]): void {
    const permission = permissionContainer.addPermission(permissionRecord.name, this.deserializeDisplayName(permissionRecord.displayName), permissionRecord.multiTenancySide, permissionRecord.isEnabled);
    this.permissionDefinitions.set(permission.name, permission);
    this.applyPermissionProperties(permission, permissionRecord);
    for (const subPermission of allPermissionRecords.filter((p) => p.parentName === permissionRecord.name)) this.addPermissionRecursively(permission, subPermission, allPermissionRecords);
  }

  private applyPermissionProperties(permission: PermissionDefinition, permissionRecord: PermissionDefinitionRecord): void {
    if (!isNullOrWhiteSpace(permissionRecord.providers)) permission.withProviders(...permissionRecord.providers.split(","));
    for (const [key, value] of permissionRecord.extraProperties) permission.properties.set(key, value);
  }
}

function cacheValueToString(value: CacheValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

/**
 * Port of `DynamicPermissionDefinitionStore`: definitions saved by `StaticPermissionSaver` (or added at runtime),
 * served from the singleton in-memory cache that is refreshed when the common stamp in the distributed cache changes.
 * The raw `IDistributedCache` of .NET is the `IDistributedCacheStore` here (same keys, no normalization).
 */
@Dependency({ lifetime: ServiceLifetime.Transient, exposes: [IDynamicPermissionDefinitionStore], replaceServices: true })
export class DynamicPermissionDefinitionStore implements IDynamicPermissionDefinitionStore {
  static readonly inject = [IPermissionGroupDefinitionRecordRepository, IPermissionDefinitionRecordRepository, IDynamicPermissionDefinitionStoreInMemoryCache, IDistributedCacheStore, optionsToken(AbpDistributedCacheOptions), optionsToken(PermissionManagementOptions), optionsToken(AbpDynamicPermissionDefinitionStoreOptions), IAbpDistributedLock] as const;
  protected readonly cacheOptions: AbpDistributedCacheOptions;
  protected readonly permissionManagementOptions: PermissionManagementOptions;
  protected readonly storeOptions: AbpDynamicPermissionDefinitionStoreOptions;

  constructor(
    protected readonly permissionGroupRepository: IPermissionGroupDefinitionRecordRepository,
    protected readonly permissionRepository: IPermissionDefinitionRecordRepository,
    protected readonly storeCache: IDynamicPermissionDefinitionStoreInMemoryCache,
    protected readonly distributedCache: IDistributedCacheStore,
    cacheOptions: IOptions<AbpDistributedCacheOptions>,
    permissionManagementOptions: IOptions<PermissionManagementOptions>,
    storeOptions: IOptions<AbpDynamicPermissionDefinitionStoreOptions>,
    protected readonly distributedLock: IAbpDistributedLock,
  ) {
    this.cacheOptions = cacheOptions.value;
    this.permissionManagementOptions = permissionManagementOptions.value;
    this.storeOptions = storeOptions.value;
  }

  async getOrNull(name: string): Promise<PermissionDefinition | undefined> {
    if (!this.permissionManagementOptions.isDynamicPermissionStoreEnabled) return undefined;
    return this.withUpToDateCache(() => this.storeCache.getPermissionOrNull(name));
  }

  async getPermissions(): Promise<readonly PermissionDefinition[]> {
    if (!this.permissionManagementOptions.isDynamicPermissionStoreEnabled) return [];
    return this.withUpToDateCache(() => this.storeCache.getPermissions());
  }

  async getResourcePermissionOrNull(resourceName: string, name: string): Promise<PermissionDefinition | undefined> {
    if (!this.permissionManagementOptions.isDynamicPermissionStoreEnabled) return undefined;
    return this.withUpToDateCache(() => this.storeCache.getResourcePermissionOrNull(resourceName, name));
  }

  async getResourcePermissions(): Promise<readonly PermissionDefinition[]> {
    if (!this.permissionManagementOptions.isDynamicPermissionStoreEnabled) return [];
    return this.withUpToDateCache(() => this.storeCache.getResourcePermissions());
  }

  async getGroups(): Promise<readonly PermissionGroupDefinition[]> {
    if (!this.permissionManagementOptions.isDynamicPermissionStoreEnabled) return [];
    return this.withUpToDateCache(() => this.storeCache.getGroups());
  }

  private withUpToDateCache<T>(read: () => T): Promise<T> {
    return this.storeCache.syncSemaphore.lock(async () => {
      await this.ensureCacheIsUpToDate();
      return read();
    });
  }

  protected async ensureCacheIsUpToDate(): Promise<void> {
    if (this.storeCache.lastCheckTime !== undefined && Date.now() - this.storeCache.lastCheckTime.getTime() < this.storeOptions.cacheRefreshIntervalMs) {
      /* We get the latest permission with a small delay for optimization */
      return;
    }

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
    const permissionGroupRecords = await this.permissionGroupRepository.getList();
    const permissionRecords = await this.permissionRepository.getList();
    await this.storeCache.fill(permissionGroupRecords, permissionRecords);
  }

  protected async getOrSetStampInDistributedCache(): Promise<string> {
    const cacheKey = this.getCommonStampCacheKey();
    const existing = cacheValueToString(await this.distributedCache.get(cacheKey));
    if (existing !== undefined) return existing;

    await using commonLockHandle = await this.distributedLock.tryAcquire(this.getCommonDistributedLockKey(), this.storeOptions.stampLockTimeoutMs);
    if (!commonLockHandle) throw new AbpException("Could not acquire distributed lock for permission definition common stamp check!");

    const stampAfterLock = cacheValueToString(await this.distributedCache.get(cacheKey));
    if (stampAfterLock !== undefined) return stampAfterLock;

    const stamp = Guid.newGuid();
    await this.distributedCache.set(cacheKey, stamp, new DistributedCacheEntryOptions({ slidingExpiration: this.storeOptions.stampSlidingExpirationMs }));
    return stamp;
  }

  protected getCommonStampCacheKey(): string {
    return `${this.cacheOptions.keyPrefix}_AbpInMemoryPermissionCacheStamp`;
  }

  protected getCommonDistributedLockKey(): string {
    return `${this.cacheOptions.keyPrefix}_Common_AbpPermissionUpdateLock`;
  }
}
