import type { Guid } from "@abp/core";
import type { EntityPredicate } from "@abp/ddd-domain";
import { DynamoDbRepository, NoCondition, dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "@abp/dynamodb";
import { FeatureDefinitionRecord, FeatureGroupDefinitionRecord, FeatureValue, parseFeatureValueDeleteArgs, parseFeatureValueFindArgs, parseFeatureValueGetListArgs, type FeatureValueDeleteArgs, type FeatureValueFindArgs, type FeatureValueGetListArgs, type IFeatureDefinitionRecordRepository, type IFeatureGroupDefinitionRecordRepository, type IFeatureValueRepository } from "../domain/index.js";
import { FeatureManagementDbContext, featureLookupIndexKey, featureProviderIndexKey } from "./feature-management-db-context.js";

/** Port of `MongoFeatureValueRepository` on the single table. */
export class DynamoDbFeatureValueRepository extends DynamoDbRepository<FeatureManagementDbContext, FeatureValue, Guid> implements IFeatureValueRepository {
  static readonly inject = [dynamoDbContextProviderToken(FeatureManagementDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<FeatureManagementDbContext>) {
    super(dbContextProvider, FeatureValue);
  }

  override find(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  override find(predicate: EntityPredicate<FeatureValue>, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  override find(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  override async find(...args: FeatureValueFindArgs): Promise<FeatureValue | undefined> {
    const lookup = parseFeatureValueFindArgs(args);
    if (!lookup) return super.find(args[0] as Guid | EntityPredicate<FeatureValue>, args[1] as boolean | undefined, args[2] as AbortSignal | undefined);
    return (await this.getDynamoDbQueryable(lookup.signal)).usingIndex("gsi3", featureLookupIndexKey(lookup.name, lookup.providerName, lookup.providerKey)).firstOrDefault(lookup.signal);
  }

  async findAll(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue[]> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi3", featureLookupIndexKey(name, providerName, providerKey)).toList(signal);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue[]>;
  override getList(predicate: EntityPredicate<FeatureValue>, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue[]>;
  override getList(providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue[]>;
  override async getList(...args: FeatureValueGetListArgs): Promise<FeatureValue[]> {
    const query = parseFeatureValueGetListArgs(args);
    if (!query) return super.getList(args[0] as EntityPredicate<FeatureValue> | boolean | undefined, args[1] as boolean | AbortSignal | undefined, args[2]);
    return (await this.getDynamoDbQueryable(query.signal)).usingIndex("gsi2", featureProviderIndexKey(query.providerName, query.providerKey)).toList(query.signal);
  }

  override delete(entity: FeatureValue, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  override delete(providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<void>;
  override async delete(...args: FeatureValueDeleteArgs): Promise<void> {
    const query = parseFeatureValueDeleteArgs(args);
    if (!query) return super.delete(args[0] as FeatureValue, args[1] as boolean | undefined, args[2]);
    const dbContext = await this.getDbContext(query.signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    const entities = await (await this.getDynamoDbQueryable(query.signal)).usingIndex("gsi2", featureProviderIndexKey(query.providerName, query.providerKey)).toList(query.signal);
    for (const entity of entities) dbContext.database.delete(dbContext.database.keyBuilder.entityKey(configuration, entity), NoCondition);
    await this.saveChanges(query.signal);
  }
}

/** Port of `MongoFeatureDefinitionRecordRepository` on the single table. */
export class DynamoDbFeatureDefinitionRecordRepository extends DynamoDbRepository<FeatureManagementDbContext, FeatureDefinitionRecord, Guid> implements IFeatureDefinitionRecordRepository {
  static readonly inject = [dynamoDbContextProviderToken(FeatureManagementDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<FeatureManagementDbContext>) {
    super(dbContextProvider, FeatureDefinitionRecord);
  }

  async findByName(name: string, signal?: AbortSignal): Promise<FeatureDefinitionRecord | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", name).firstOrDefault(signal);
  }
}

/** Port of `MongoFeatureGroupDefinitionRecordRepository` on the single table. */
export class DynamoDbFeatureGroupDefinitionRecordRepository extends DynamoDbRepository<FeatureManagementDbContext, FeatureGroupDefinitionRecord, Guid> implements IFeatureGroupDefinitionRecordRepository {
  static readonly inject = [dynamoDbContextProviderToken(FeatureManagementDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<FeatureManagementDbContext>) {
    super(dbContextProvider, FeatureGroupDefinitionRecord);
  }
}
