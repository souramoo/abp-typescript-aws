import { Transient, type Guid } from "@abp/core";
import { DynamoDbRepository, dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "@abp/dynamodb";
import { IPermissionDefinitionRecordRepository, IPermissionGrantRepository, IPermissionGroupDefinitionRecordRepository, PermissionDefinitionRecord, PermissionGrant, PermissionGroupDefinitionRecord, permissionGrantProviderKey } from "../domain/index.js";
import { PermissionManagementDynamoDbContext } from "./permission-management-dynamodb-context.js";

const contextProviderToken = dynamoDbContextProviderToken(PermissionManagementDynamoDbContext);

/** Port of `MongoPermissionGrantRepository`: provider lookups through the `gsi2` partition `providerName#providerKey`. */
@Transient(IPermissionGrantRepository)
export class DynamoDbPermissionGrantRepository extends DynamoDbRepository<PermissionManagementDynamoDbContext, PermissionGrant, Guid> implements IPermissionGrantRepository {
  static readonly inject = [contextProviderToken] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<PermissionManagementDynamoDbContext>) {
    super(dbContextProvider, PermissionGrant);
  }

  async findGrant(name: string, providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", permissionGrantProviderKey(providerName, providerKey), { eq: name }).orderBy("id").firstOrDefault(signal);
  }

  async getListByProvider(providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant[]> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", permissionGrantProviderKey(providerName, providerKey)).toList(signal);
  }

  async getListByNames(names: readonly string[], providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant[]> {
    const wanted = new Set(names);
    return (await this.getDynamoDbQueryable(signal))
      .usingIndex("gsi2", permissionGrantProviderKey(providerName, providerKey))
      .where((g) => wanted.has(g.name))
      .toList(signal);
  }
}

/** Port of `MongoPermissionDefinitionRecordRepository`. */
@Transient(IPermissionDefinitionRecordRepository)
export class DynamoDbPermissionDefinitionRecordRepository extends DynamoDbRepository<PermissionManagementDynamoDbContext, PermissionDefinitionRecord, Guid> implements IPermissionDefinitionRecordRepository {
  static readonly inject = [contextProviderToken] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<PermissionManagementDynamoDbContext>) {
    super(dbContextProvider, PermissionDefinitionRecord);
  }

  async findByName(name: string, signal?: AbortSignal): Promise<PermissionDefinitionRecord | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", name).orderBy("id").firstOrDefault(signal);
  }
}

/** Port of `MongoPermissionGroupDefinitionRecordRepository`. */
@Transient(IPermissionGroupDefinitionRecordRepository)
export class DynamoDbPermissionGroupDefinitionRecordRepository extends DynamoDbRepository<PermissionManagementDynamoDbContext, PermissionGroupDefinitionRecord, Guid> implements IPermissionGroupDefinitionRecordRepository {
  static readonly inject = [contextProviderToken] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<PermissionManagementDynamoDbContext>) {
    super(dbContextProvider, PermissionGroupDefinitionRecord);
  }
}
