import type { Guid } from "@abp/core";
import { isPredicate, type EntityPredicate } from "@abp/ddd-domain";
import { MemoryDbRepository, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import {
  AuditLog,
  averageExecutionDurationPerDay,
  countAuditLogs,
  countEntityChanges,
  findEntityChange,
  findEntityChangeWithUsername,
  isAuditLogFilterCall,
  listAuditLogs,
  listEntityChanges,
  listEntityChangesWithUsername,
  type AuditLogFilter,
  type EntityChange,
  type EntityChangeFilter,
  type EntityChangeWithUsername,
  type GetAuditLogListInput,
  type GetEntityChangeListInput,
  type IAuditLogRepository,
} from "../domain/index.js";
import { AuditLoggingMemoryDbContext } from "./audit-logging-memory-db-context.js";

/** `IAuditLogRepository` over `@abp/memory-db`. */
export class MemoryAuditLogRepository extends MemoryDbRepository<AuditLoggingMemoryDbContext, AuditLog, Guid> implements IAuditLogRepository {
  static readonly inject = [memoryDatabaseProviderToken(AuditLoggingMemoryDbContext)] as const;

  constructor(databaseProvider: IMemoryDatabaseProvider<AuditLoggingMemoryDbContext>) {
    super(databaseProvider, AuditLog);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<AuditLog[]>;
  override getList(predicate: EntityPredicate<AuditLog>, includeDetails?: boolean, signal?: AbortSignal): Promise<AuditLog[]>;
  override getList(input: GetAuditLogListInput, signal?: AbortSignal): Promise<AuditLog[]>;
  override async getList(first?: boolean | EntityPredicate<AuditLog> | GetAuditLogListInput, second?: boolean | AbortSignal, third?: AbortSignal): Promise<AuditLog[]> {
    if (isAuditLogFilterCall(first)) return listAuditLogs(await this.getQueryable(), first, second as AbortSignal | undefined);
    if (isPredicate<AuditLog>(first)) return super.getList(first, second as boolean | undefined, third);
    return super.getList(first as boolean | undefined, second, third);
  }

  override getCount(signal?: AbortSignal): Promise<number>;
  override getCount(filter: AuditLogFilter, signal?: AbortSignal): Promise<number>;
  override async getCount(first?: AbortSignal | AuditLogFilter, signal?: AbortSignal): Promise<number> {
    if (isAuditLogFilterCall(first)) return countAuditLogs(await this.getQueryable(), first, signal);
    return super.getCount(first);
  }

  async getAverageExecutionDurationPerDay(startDate: Date, endDate: Date, signal?: AbortSignal): Promise<Map<string, number>> {
    return averageExecutionDurationPerDay(await this.getQueryable(), startDate, endDate, signal);
  }

  async getEntityChange(entityChangeId: Guid, signal?: AbortSignal): Promise<EntityChange> {
    return findEntityChange(await this.getQueryable(), entityChangeId, signal);
  }

  async getEntityChangeList(input: GetEntityChangeListInput, signal?: AbortSignal): Promise<EntityChange[]> {
    return listEntityChanges(await this.getQueryable(), input, signal);
  }

  async getEntityChangeCount(filter: EntityChangeFilter, signal?: AbortSignal): Promise<number> {
    return countEntityChanges(await this.getQueryable(), filter, signal);
  }

  async getEntityChangeWithUsername(entityChangeId: Guid, signal?: AbortSignal): Promise<EntityChangeWithUsername> {
    return findEntityChangeWithUsername(await this.getQueryable(), entityChangeId, signal);
  }

  async getEntityChangesWithUsername(entityId: string, entityTypeFullName: string, signal?: AbortSignal): Promise<EntityChangeWithUsername[]> {
    return listEntityChangesWithUsername(await this.getQueryable(), entityId, entityTypeFullName, signal);
  }
}
