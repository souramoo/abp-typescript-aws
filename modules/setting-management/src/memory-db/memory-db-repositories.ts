import type { Guid } from "@abp/core";
import type { EntityPredicate } from "@abp/ddd-domain";
import { MemoryDbRepository, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import type { ISettingDefinitionRecordRepository, ISettingRepository} from "../domain/index.js";
import { Setting, SettingDefinitionRecord, parseSettingFindArgs, parseSettingGetListArgs, type SettingFindArgs, type SettingGetListArgs } from "../domain/index.js";
import { SettingManagementMemoryDbContext } from "./setting-management-memory-db-context.js";

/** In-memory `ISettingRepository`. */
export class MemoryDbSettingRepository extends MemoryDbRepository<SettingManagementMemoryDbContext, Setting, Guid> implements ISettingRepository {
  static readonly inject = [memoryDatabaseProviderToken(SettingManagementMemoryDbContext)] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<SettingManagementMemoryDbContext>) {
    super(databaseProvider, Setting);
  }

  override find(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting | undefined>;
  override find(predicate: EntityPredicate<Setting>, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting | undefined>;
  override find(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting | undefined>;
  override async find(...args: SettingFindArgs): Promise<Setting | undefined> {
    const lookup = parseSettingFindArgs(args);
    if (!lookup) return super.find(args[0] as Guid | EntityPredicate<Setting>, args[1] as boolean | undefined, args[2] as AbortSignal | undefined);
    return (await this.getQueryable())
      .where((s) => s.name === lookup.name && s.providerName === lookup.providerName && s.providerKey === lookup.providerKey)
      .orderBy("id")
      .firstOrDefault(lookup.signal);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<Setting[]>;
  override getList(predicate: EntityPredicate<Setting>, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting[]>;
  override getList(providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting[]>;
  override getList(names: readonly string[], providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting[]>;
  override async getList(...args: SettingGetListArgs): Promise<Setting[]> {
    const query = parseSettingGetListArgs(args);
    if (!query) return super.getList(args[0] as EntityPredicate<Setting> | boolean | undefined, args[1] as boolean | AbortSignal | undefined, args[2] as AbortSignal | undefined);
    const names = query.names === undefined ? undefined : new Set(query.names);
    return (await this.getQueryable()).where((s) => s.providerName === query.providerName && s.providerKey === query.providerKey && (names === undefined || names.has(s.name))).toList(query.signal);
  }
}

/** In-memory `ISettingDefinitionRecordRepository`. */
export class MemoryDbSettingDefinitionRecordRepository extends MemoryDbRepository<SettingManagementMemoryDbContext, SettingDefinitionRecord, Guid> implements ISettingDefinitionRecordRepository {
  static readonly inject = [memoryDatabaseProviderToken(SettingManagementMemoryDbContext)] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<SettingManagementMemoryDbContext>) {
    super(databaseProvider, SettingDefinitionRecord);
  }

  async findByName(name: string, signal?: AbortSignal): Promise<SettingDefinitionRecord | undefined> {
    return (await this.getQueryable())
      .where((r) => r.name === name)
      .orderBy("id")
      .firstOrDefault(signal);
  }
}
