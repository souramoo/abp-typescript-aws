import { createToken, isNullOrEmptyString, isNullOrWhiteSpace, type Guid } from "@abp/core";
import type { EntityChangeType } from "@abp/auditing";
import { EntityNotFoundException, executeQueryPlan, type EntityPredicate, type IQueryable, type IRepository } from "@abp/ddd-domain";
import type { AuditLog } from "./audit-log.js";
import { EntityChange, EntityChangeWithUsername } from "./entity-change.js";

/** The filter parameters of `IAuditLogRepository.GetListAsync` / `GetCountAsync` (named instead of positional). */
export interface AuditLogFilter {
  startTime?: Date;
  endTime?: Date;
  httpMethod?: string;
  url?: string;
  clientId?: string;
  userId?: Guid;
  userName?: string;
  applicationName?: string;
  clientIpAddress?: string;
  correlationId?: string;
  maxExecutionDuration?: number;
  minExecutionDuration?: number;
  hasException?: boolean;
  /** `HttpStatusCode?` in .NET: a status code number. */
  httpStatusCode?: number;
}

export interface GetAuditLogListInput extends AuditLogFilter {
  /** Default: `"executionTime desc"`. */
  sorting?: string | null;
  /** Default: 50. */
  maxResultCount?: number;
  /** Default: 0. */
  skipCount?: number;
  includeDetails?: boolean;
}

/** The filter parameters of `GetEntityChangeListAsync` / `GetEntityChangeCountAsync`. */
export interface EntityChangeFilter {
  auditLogId?: Guid;
  startTime?: Date;
  endTime?: Date;
  changeType?: EntityChangeType;
  entityId?: string;
  entityTypeFullName?: string;
}

export interface GetEntityChangeListInput extends EntityChangeFilter {
  /** Default: `"changeTime desc"`. */
  sorting?: string | null;
  /** Default: 50. */
  maxResultCount?: number;
  /** Default: 0. */
  skipCount?: number;
  includeDetails?: boolean;
}

/**
 * Port of `IAuditLogRepository`. The long optional parameter lists of .NET became filter objects; the
 * `GetListAsync`/`GetCountAsync` overloads keep their names and are distinguished by argument type.
 * `getAverageExecutionDurationPerDay` is keyed by the UTC day (`YYYY-MM-DD`) instead of a `DateTime`.
 */
export interface IAuditLogRepository extends IRepository<AuditLog, Guid> {
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<AuditLog[]>;
  getList(predicate: EntityPredicate<AuditLog>, includeDetails?: boolean, signal?: AbortSignal): Promise<AuditLog[]>;
  getList(input: GetAuditLogListInput, signal?: AbortSignal): Promise<AuditLog[]>;
  getCount(signal?: AbortSignal): Promise<number>;
  getCount(filter: AuditLogFilter, signal?: AbortSignal): Promise<number>;
  getAverageExecutionDurationPerDay(startDate: Date, endDate: Date, signal?: AbortSignal): Promise<Map<string, number>>;
  getEntityChange(entityChangeId: Guid, signal?: AbortSignal): Promise<EntityChange>;
  getEntityChangeList(input: GetEntityChangeListInput, signal?: AbortSignal): Promise<EntityChange[]>;
  getEntityChangeCount(filter: EntityChangeFilter, signal?: AbortSignal): Promise<number>;
  getEntityChangeWithUsername(entityChangeId: Guid, signal?: AbortSignal): Promise<EntityChangeWithUsername>;
  getEntityChangesWithUsername(entityId: string, entityTypeFullName: string, signal?: AbortSignal): Promise<EntityChangeWithUsername[]>;
}
export const IAuditLogRepository = createToken<IAuditLogRepository>("IAuditLogRepository");

/** True for the `getList(input)` / `getCount(filter)` overloads (a plain options object, not a predicate/specification). */
export function isAuditLogFilterCall(value: unknown): value is AuditLogFilter {
  return typeof value === "object" && value !== null && !(value instanceof AbortSignal) && typeof (value as { toExpression?: unknown }).toExpression !== "function";
}

/** Port of the `WhereIf(...)` chain of `GetListQueryAsync`. */
export function auditLogFilterPredicate(filter: AuditLogFilter): (auditLog: AuditLog) => boolean {
  const { startTime, endTime, hasException, httpMethod, url, clientId, userId, userName, applicationName, clientIpAddress, correlationId, httpStatusCode, maxExecutionDuration, minExecutionDuration } = filter;
  return (auditLog) => {
    if (startTime !== undefined && auditLog.executionTime.getTime() < startTime.getTime()) return false;
    if (endTime !== undefined && auditLog.executionTime.getTime() > endTime.getTime()) return false;
    if (hasException === true && isNullOrEmptyString(auditLog.exceptions)) return false;
    if (hasException === false && !isNullOrEmptyString(auditLog.exceptions)) return false;
    if (!isNullOrEmptyString(httpMethod) && auditLog.httpMethod !== httpMethod) return false;
    if (!isNullOrEmptyString(url) && !(auditLog.url !== undefined && auditLog.url.includes(url))) return false;
    if (!isNullOrEmptyString(clientId) && auditLog.clientId !== clientId) return false;
    if (userId !== undefined && auditLog.userId !== userId) return false;
    if (!isNullOrEmptyString(userName) && auditLog.userName !== userName) return false;
    if (!isNullOrEmptyString(applicationName) && auditLog.applicationName !== applicationName) return false;
    if (!isNullOrEmptyString(clientIpAddress) && auditLog.clientIpAddress !== clientIpAddress) return false;
    if (!isNullOrEmptyString(correlationId) && auditLog.correlationId !== correlationId) return false;
    if (httpStatusCode !== undefined && httpStatusCode > 0 && auditLog.httpStatusCode !== httpStatusCode) return false;
    if (maxExecutionDuration !== undefined && maxExecutionDuration > 0 && auditLog.executionDuration > maxExecutionDuration) return false;
    if (minExecutionDuration !== undefined && minExecutionDuration > 0 && auditLog.executionDuration < minExecutionDuration) return false;
    return true;
  };
}

/**
 * Port of the `WhereIf(...)` chain of `GetEntityChangeListQueryAsync`. `auditLogId` filters on the change's
 * `auditLogId` (the intended semantics of the EF Core repository; the MongoDB one compares the change id).
 */
export function entityChangeFilterPredicate(filter: EntityChangeFilter): (entityChange: EntityChange) => boolean {
  const { auditLogId, startTime, endTime, changeType, entityId, entityTypeFullName } = filter;
  return (entityChange) => {
    if (auditLogId !== undefined && entityChange.auditLogId !== auditLogId) return false;
    if (startTime !== undefined && entityChange.changeTime.getTime() < startTime.getTime()) return false;
    if (endTime !== undefined && entityChange.changeTime.getTime() > endTime.getTime()) return false;
    if (changeType !== undefined && entityChange.changeType !== changeType) return false;
    if (!isNullOrWhiteSpace(entityId) && entityChange.entityId !== entityId) return false;
    if (!isNullOrWhiteSpace(entityTypeFullName) && !entityChange.entityTypeFullName.includes(entityTypeFullName)) return false;
    return true;
  };
}

/* The provider-independent parts of `MongoAuditLogRepository`, shared by the DynamoDB and memory implementations. */

export function listAuditLogs(query: IQueryable<AuditLog>, input: GetAuditLogListInput, signal?: AbortSignal): Promise<AuditLog[]> {
  return query
    .where(auditLogFilterPredicate(input))
    .orderBySorting(isNullOrWhiteSpace(input.sorting) ? "executionTime desc" : input.sorting)
    .skip(input.skipCount ?? 0)
    .take(input.maxResultCount ?? 50)
    .toList(signal);
}

export function countAuditLogs(query: IQueryable<AuditLog>, filter: AuditLogFilter, signal?: AbortSignal): Promise<number> {
  return query.where(auditLogFilterPredicate(filter)).count(signal);
}

/** Port of `GetAverageExecutionDurationPerDayAsync`: `{ "YYYY-MM-DD": average ms }` for `startDate < executionTime < endDate + 1 day`. */
export async function averageExecutionDurationPerDay(query: IQueryable<AuditLog>, startDate: Date, endDate: Date, signal?: AbortSignal): Promise<Map<string, number>> {
  const exclusiveEnd = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
  const logs = await query
    .where((a) => a.executionTime.getTime() < exclusiveEnd.getTime() && a.executionTime.getTime() > startDate.getTime())
    .orderBy("executionTime")
    .toList(signal);

  const totals = new Map<string, { sum: number; count: number }>();
  for (const log of logs) {
    const day = log.executionTime.toISOString().slice(0, 10);
    const entry = totals.get(day) ?? { sum: 0, count: 0 };
    entry.sum += log.executionDuration;
    entry.count += 1;
    totals.set(day, entry);
  }
  return new Map([...totals].map(([day, { sum, count }]) => [day, sum / count]));
}

async function allEntityChanges(query: IQueryable<AuditLog>, signal?: AbortSignal): Promise<EntityChange[]> {
  return (await query.toList(signal)).flatMap((auditLog) => auditLog.entityChanges);
}

export async function findEntityChange(query: IQueryable<AuditLog>, entityChangeId: Guid, signal?: AbortSignal): Promise<EntityChange> {
  const auditLog = await query.where((x) => x.entityChanges.some((y) => y.id === entityChangeId)).orderBy("id").firstOrDefault(signal);
  const entityChange = auditLog?.entityChanges.find((x) => x.id === entityChangeId);
  if (!entityChange) throw new EntityNotFoundException(EntityChange, entityChangeId);
  return entityChange;
}

export async function listEntityChanges(query: IQueryable<AuditLog>, input: GetEntityChangeListInput, signal?: AbortSignal): Promise<EntityChange[]> {
  const changes = (await allEntityChanges(query, signal)).filter(entityChangeFilterPredicate(input));
  const sorting = isNullOrWhiteSpace(input.sorting) ? "changeTime desc" : input.sorting;
  return executeQueryPlan(changes, {
    predicates: [],
    ordering: sorting
      .split(",")
      .map((clause) => clause.trim().split(/\s+/))
      .map(([field, direction]) => ({ key: field ?? "changeTime", direction: direction?.toLowerCase() === "desc" ? "desc" : "asc" })),
    skipCount: input.skipCount ?? 0,
    takeCount: input.maxResultCount ?? 50,
  });
}

export async function countEntityChanges(query: IQueryable<AuditLog>, filter: EntityChangeFilter, signal?: AbortSignal): Promise<number> {
  return (await allEntityChanges(query, signal)).filter(entityChangeFilterPredicate(filter)).length;
}

export async function findEntityChangeWithUsername(query: IQueryable<AuditLog>, entityChangeId: Guid, signal?: AbortSignal): Promise<EntityChangeWithUsername> {
  const auditLog = await query.where((x) => x.entityChanges.some((y) => y.id === entityChangeId)).first(signal);
  return new EntityChangeWithUsername(auditLog.entityChanges.find((x) => x.id === entityChangeId)!, auditLog.userName);
}

export async function listEntityChangesWithUsername(query: IQueryable<AuditLog>, entityId: string, entityTypeFullName: string, signal?: AbortSignal): Promise<EntityChangeWithUsername[]> {
  const auditLogs = await query
    .where((x) => x.entityChanges.some((y) => y.entityId === entityId && y.entityTypeFullName === entityTypeFullName))
    .orderBy("executionTime", "desc")
    .toList(signal);

  return auditLogs.flatMap((auditLog) => auditLog.entityChanges.filter((x) => x.entityId === entityId && x.entityTypeFullName === entityTypeFullName).map((x) => new EntityChangeWithUsername(x, auditLog.userName)));
}
