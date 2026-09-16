import { isNullOrEmptyString, type Guid } from "@abp/core";
import { DynamoDbRepository, dynamoDbContextProviderToken, type DynamoDbEntityConfiguration, type DynamoDbItem, type DynamoDbQueryable, type DynamoDbSortKeyCondition, type IDynamoDbContextProvider } from "@abp/dynamodb";
import { isPredicate, type EntityPredicate, type IQueryable } from "@abp/ddd-domain";
import {
  AuditLog,
  AuditLogAction,
  EntityChange,
  EntityPropertyChange,
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
  type EntityChangeFilter,
  type EntityChangeWithUsername,
  type GetAuditLogListInput,
  type GetEntityChangeListInput,
  type IAuditLogRepository,
} from "../domain/index.js";
import { AuditLoggingDbContext } from "./audit-logging-db-context.js";

function executionTimeCondition(filter: AuditLogFilter): DynamoDbSortKeyCondition | undefined {
  const start = filter.startTime?.toISOString();
  const end = filter.endTime?.toISOString();
  if (start !== undefined && end !== undefined) return { between: [start, end] };
  if (start !== undefined) return { gte: start };
  if (end !== undefined) return { lte: end };
  return undefined;
}

/**
 * Port of `MongoAuditLogRepository`. A `userId` filter queries `gsi2` and a `correlationId` filter `gsi3` (with the
 * time range as the sort-key condition); every other filter is evaluated in memory over the tenant's partition.
 */
export class DynamoDbAuditLogRepository extends DynamoDbRepository<AuditLoggingDbContext, AuditLog, Guid> implements IAuditLogRepository {
  static readonly inject = [dynamoDbContextProviderToken(AuditLoggingDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<AuditLoggingDbContext>) {
    super(dbContextProvider, AuditLog);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<AuditLog[]>;
  override getList(predicate: EntityPredicate<AuditLog>, includeDetails?: boolean, signal?: AbortSignal): Promise<AuditLog[]>;
  override getList(input: GetAuditLogListInput, signal?: AbortSignal): Promise<AuditLog[]>;
  override async getList(first?: boolean | EntityPredicate<AuditLog> | GetAuditLogListInput, second?: boolean | AbortSignal, third?: AbortSignal): Promise<AuditLog[]> {
    if (isAuditLogFilterCall(first)) return listAuditLogs(await this.filteredQuery(first, second as AbortSignal | undefined), first, second as AbortSignal | undefined);
    if (isPredicate<AuditLog>(first)) return super.getList(first, second as boolean | undefined, third);
    return super.getList(first as boolean | undefined, second, third);
  }

  override getCount(signal?: AbortSignal): Promise<number>;
  override getCount(filter: AuditLogFilter, signal?: AbortSignal): Promise<number>;
  override async getCount(first?: AbortSignal | AuditLogFilter, signal?: AbortSignal): Promise<number> {
    if (isAuditLogFilterCall(first)) return countAuditLogs(await this.filteredQuery(first, signal), first, signal);
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

  /** The index partition the filter can be answered from; the remaining conditions are applied by the shared predicate. */
  protected async filteredQuery(filter: AuditLogFilter, signal?: AbortSignal): Promise<IQueryable<AuditLog>> {
    const query: DynamoDbQueryable<AuditLog> = await this.getDynamoDbQueryable(signal);
    if (filter.userId !== undefined) return query.usingIndex("gsi2", filter.userId, executionTimeCondition(filter));
    if (!isNullOrEmptyString(filter.correlationId)) return query.usingIndex("gsi3", filter.correlationId, executionTimeCondition(filter));
    return query;
  }

  /** Nested entities are revived as plain objects by the serializer; restore their prototypes like a BSON class map would. */
  protected override toEntity(item: DynamoDbItem, configuration: DynamoDbEntityConfiguration<AuditLog>): AuditLog {
    const auditLog = super.toEntity(item, configuration);
    for (const action of auditLog.actions) Object.setPrototypeOf(action, AuditLogAction.prototype);
    for (const change of auditLog.entityChanges) {
      Object.setPrototypeOf(change, EntityChange.prototype);
      for (const propertyChange of change.propertyChanges) Object.setPrototypeOf(propertyChange, EntityPropertyChange.prototype);
    }
    return auditLog;
  }
}
