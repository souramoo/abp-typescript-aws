import type { Guid } from "@abp/core";
import type { EntityPredicate } from "@abp/ddd-domain";
import { DynamoDbRepository, dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "@abp/dynamodb";
import type { ISettingDefinitionRecordRepository, ISettingRepository} from "../domain/index.js";
import { Setting, SettingDefinitionRecord, parseSettingFindArgs, parseSettingGetListArgs, type SettingFindArgs, type SettingGetListArgs } from "../domain/index.js";
import { SettingManagementDbContext, settingLookupIndexKey, settingProviderIndexKey } from "./setting-management-db-context.js";

/** Port of `MongoSettingRepository` on the single table. */
export class DynamoDbSettingRepository extends DynamoDbRepository<SettingManagementDbContext, Setting, Guid> implements ISettingRepository {
  static readonly inject = [dynamoDbContextProviderToken(SettingManagementDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<SettingManagementDbContext>) {
    super(dbContextProvider, Setting);
  }

  override find(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting | undefined>;
  override find(predicate: EntityPredicate<Setting>, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting | undefined>;
  override find(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting | undefined>;
  override async find(...args: SettingFindArgs): Promise<Setting | undefined> {
    const lookup = parseSettingFindArgs(args);
    if (!lookup) return super.find(args[0] as Guid | EntityPredicate<Setting>, args[1] as boolean | undefined, args[2] as AbortSignal | undefined);
    return (await this.getDynamoDbQueryable(lookup.signal)).usingIndex("gsi3", settingLookupIndexKey(lookup.name, lookup.providerName, lookup.providerKey)).firstOrDefault(lookup.signal);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<Setting[]>;
  override getList(predicate: EntityPredicate<Setting>, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting[]>;
  override getList(providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting[]>;
  override getList(names: readonly string[], providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting[]>;
  override async getList(...args: SettingGetListArgs): Promise<Setting[]> {
    const query = parseSettingGetListArgs(args);
    if (!query) return super.getList(args[0] as EntityPredicate<Setting> | boolean | undefined, args[1] as boolean | AbortSignal | undefined, args[2] as AbortSignal | undefined);
    const byProvider = (await this.getDynamoDbQueryable(query.signal)).usingIndex("gsi2", settingProviderIndexKey(query.providerName, query.providerKey));
    const names = query.names === undefined ? undefined : new Set(query.names);
    return (names === undefined ? byProvider : byProvider.where((s) => names.has(s.name))).toList(query.signal);
  }
}

/** Port of `MongoSettingDefinitionRecordRepository` on the single table. */
export class DynamoDbSettingDefinitionRecordRepository extends DynamoDbRepository<SettingManagementDbContext, SettingDefinitionRecord, Guid> implements ISettingDefinitionRecordRepository {
  static readonly inject = [dynamoDbContextProviderToken(SettingManagementDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<SettingManagementDbContext>) {
    super(dbContextProvider, SettingDefinitionRecord);
  }

  async findByName(name: string, signal?: AbortSignal): Promise<SettingDefinitionRecord | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", name).firstOrDefault(signal);
  }
}
