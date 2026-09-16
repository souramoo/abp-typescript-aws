import type { Guid } from "@abp/core";
import type { EntityPredicate } from "@abp/ddd-domain";
import { MemoryDbRepository, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import { FeatureDefinitionRecord, FeatureGroupDefinitionRecord, FeatureValue, parseFeatureValueDeleteArgs, parseFeatureValueFindArgs, parseFeatureValueGetListArgs, type FeatureValueDeleteArgs, type FeatureValueFindArgs, type FeatureValueGetListArgs, type IFeatureDefinitionRecordRepository, type IFeatureGroupDefinitionRecordRepository, type IFeatureValueRepository } from "../domain/index.js";
import { FeatureManagementMemoryDbContext } from "./feature-management-memory-db-context.js";

/** In-memory `IFeatureValueRepository`. */
export class MemoryDbFeatureValueRepository extends MemoryDbRepository<FeatureManagementMemoryDbContext, FeatureValue, Guid> implements IFeatureValueRepository {
  static readonly inject = [memoryDatabaseProviderToken(FeatureManagementMemoryDbContext)] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<FeatureManagementMemoryDbContext>) {
    super(databaseProvider, FeatureValue);
  }

  override find(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  override find(predicate: EntityPredicate<FeatureValue>, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  override find(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  override async find(...args: FeatureValueFindArgs): Promise<FeatureValue | undefined> {
    const lookup = parseFeatureValueFindArgs(args);
    if (!lookup) return super.find(args[0] as Guid | EntityPredicate<FeatureValue>, args[1] as boolean | undefined, args[2] as AbortSignal | undefined);
    return (await this.getQueryable())
      .where((f) => f.name === lookup.name && f.providerName === lookup.providerName && f.providerKey === lookup.providerKey)
      .orderBy("id")
      .firstOrDefault(lookup.signal);
  }

  async findAll(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue[]> {
    return (await this.getQueryable()).where((f) => f.name === name && f.providerName === providerName && f.providerKey === providerKey).toList(signal);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue[]>;
  override getList(predicate: EntityPredicate<FeatureValue>, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue[]>;
  override getList(providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue[]>;
  override async getList(...args: FeatureValueGetListArgs): Promise<FeatureValue[]> {
    const query = parseFeatureValueGetListArgs(args);
    if (!query) return super.getList(args[0] as EntityPredicate<FeatureValue> | boolean | undefined, args[1] as boolean | AbortSignal | undefined, args[2]);
    return (await this.getQueryable()).where((f) => f.providerName === query.providerName && f.providerKey === query.providerKey).toList(query.signal);
  }

  override delete(entity: FeatureValue, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  override delete(providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<void>;
  override async delete(...args: FeatureValueDeleteArgs): Promise<void> {
    const query = parseFeatureValueDeleteArgs(args);
    if (!query) return super.delete(args[0] as FeatureValue, args[1] as boolean | undefined);
    await this.deleteDirect((f) => f.providerName === query.providerName && f.providerKey === query.providerKey);
  }
}

/** In-memory `IFeatureDefinitionRecordRepository`. */
export class MemoryDbFeatureDefinitionRecordRepository extends MemoryDbRepository<FeatureManagementMemoryDbContext, FeatureDefinitionRecord, Guid> implements IFeatureDefinitionRecordRepository {
  static readonly inject = [memoryDatabaseProviderToken(FeatureManagementMemoryDbContext)] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<FeatureManagementMemoryDbContext>) {
    super(databaseProvider, FeatureDefinitionRecord);
  }

  async findByName(name: string, signal?: AbortSignal): Promise<FeatureDefinitionRecord | undefined> {
    return (await this.getQueryable())
      .where((r) => r.name === name)
      .orderBy("id")
      .firstOrDefault(signal);
  }
}

/** In-memory `IFeatureGroupDefinitionRecordRepository`. */
export class MemoryDbFeatureGroupDefinitionRecordRepository extends MemoryDbRepository<FeatureManagementMemoryDbContext, FeatureGroupDefinitionRecord, Guid> implements IFeatureGroupDefinitionRecordRepository {
  static readonly inject = [memoryDatabaseProviderToken(FeatureManagementMemoryDbContext)] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<FeatureManagementMemoryDbContext>) {
    super(databaseProvider, FeatureGroupDefinitionRecord);
  }
}
