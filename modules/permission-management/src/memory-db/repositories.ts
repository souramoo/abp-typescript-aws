import { Transient, type Guid } from "@abp/core";
import { MemoryDbRepository, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import { IPermissionDefinitionRecordRepository, IPermissionGrantRepository, IPermissionGroupDefinitionRecordRepository, PermissionDefinitionRecord, PermissionGrant, PermissionGroupDefinitionRecord } from "../domain/index.js";
import { PermissionManagementMemoryDbContext } from "./permission-management-memory-db-context.js";

const databaseProviderToken = memoryDatabaseProviderToken(PermissionManagementMemoryDbContext);

@Transient(IPermissionGrantRepository)
export class MemoryDbPermissionGrantRepository extends MemoryDbRepository<PermissionManagementMemoryDbContext, PermissionGrant, Guid> implements IPermissionGrantRepository {
  static readonly inject = [databaseProviderToken] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<PermissionManagementMemoryDbContext>) {
    super(databaseProvider, PermissionGrant);
  }

  async findGrant(name: string, providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant | undefined> {
    return (await this.getQueryable())
      .where((s) => s.name === name && s.providerName === providerName && s.providerKey === providerKey)
      .orderBy("id")
      .firstOrDefault(signal);
  }

  async getListByProvider(providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant[]> {
    return (await this.getQueryable()).where((s) => s.providerName === providerName && s.providerKey === providerKey).toList(signal);
  }

  async getListByNames(names: readonly string[], providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant[]> {
    const wanted = new Set(names);
    return (await this.getQueryable()).where((s) => wanted.has(s.name) && s.providerName === providerName && s.providerKey === providerKey).toList(signal);
  }
}

@Transient(IPermissionDefinitionRecordRepository)
export class MemoryDbPermissionDefinitionRecordRepository extends MemoryDbRepository<PermissionManagementMemoryDbContext, PermissionDefinitionRecord, Guid> implements IPermissionDefinitionRecordRepository {
  static readonly inject = [databaseProviderToken] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<PermissionManagementMemoryDbContext>) {
    super(databaseProvider, PermissionDefinitionRecord);
  }

  async findByName(name: string, signal?: AbortSignal): Promise<PermissionDefinitionRecord | undefined> {
    return (await this.getQueryable()).where((s) => s.name === name).orderBy("id").firstOrDefault(signal);
  }
}

@Transient(IPermissionGroupDefinitionRecordRepository)
export class MemoryDbPermissionGroupDefinitionRecordRepository extends MemoryDbRepository<PermissionManagementMemoryDbContext, PermissionGroupDefinitionRecord, Guid> implements IPermissionGroupDefinitionRecordRepository {
  static readonly inject = [databaseProviderToken] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<PermissionManagementMemoryDbContext>) {
    super(databaseProvider, PermissionGroupDefinitionRecord);
  }
}
