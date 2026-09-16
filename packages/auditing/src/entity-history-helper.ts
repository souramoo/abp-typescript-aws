import { Transient, createToken, optionsToken, truncate, type Class, type IOptions } from "@abp/core";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { IClock } from "@abp/timing";
import { AbpAuditingOptions } from "./abp-auditing-options.js";
import { EntityChangeInfo, EntityPropertyChangeInfo } from "./audit-log-info.js";
import { IAuditSerializer, isInstanceOfAny } from "./audit-serializer.js";
import { IAuditingHelper } from "./auditing-helper.js";
import { IAuditingManager } from "./auditing-manager.js";
import { AuditedMetadata, DisableAuditingMetadata, EntityChangeType } from "./contracts.js";

/** Property values of an entity before (`original`) and after (`current`) a change. */
export interface EntitySnapshot {
  readonly original?: Readonly<Record<string, unknown>>;
  readonly current?: Readonly<Record<string, unknown>>;
}

/**
 * Minimal port of the EF Core `IEntityHistoryHelper` shape, independent of a change tracker: repositories
 * (DynamoDB, memory) feed before/after snapshots and the helper turns them into `EntityChangeInfo`s.
 */
export interface IEntityHistoryHelper {
  isEntityHistoryEnabled(entityType: Class): boolean;
  /** True when the property takes part in entity history (`@DisableAuditing()` members are excluded). */
  shouldSavePropertyHistory(entityType: Class, propertyName: string): boolean;
  createPropertyChanges(entityType: Class, changeType: EntityChangeType, snapshot: EntitySnapshot): EntityPropertyChangeInfo[];
  /** Creates the change of `entity`; returns undefined when history is disabled for its class or nothing changed on update. */
  createEntityChangeInfo(entity: object, changeType: EntityChangeType, changes: EntitySnapshot | readonly EntityPropertyChangeInfo[]): EntityChangeInfo | undefined;
  /** Port of `UpdateChangeList` + `Save`: adds the changes to the current audit log scope; false when there is none. */
  addToCurrentAuditLog(entityChanges: Iterable<EntityChangeInfo>): boolean;
}
export const IEntityHistoryHelper = createToken<IEntityHistoryHelper>("IEntityHistoryHelper");

@Transient(IEntityHistoryHelper)
export class EntityHistoryHelper implements IEntityHistoryHelper {
  static readonly inject = [IAuditingHelper, IAuditingManager, IAuditSerializer, IClock, optionsToken(AbpAuditingOptions)] as const;
  protected readonly options: AbpAuditingOptions;

  constructor(
    protected readonly auditingHelper: IAuditingHelper,
    protected readonly auditingManager: IAuditingManager,
    protected readonly auditSerializer: IAuditSerializer,
    protected readonly clock: IClock,
    options: IOptions<AbpAuditingOptions>,
  ) {
    this.options = options.value;
  }

  isEntityHistoryEnabled(entityType: Class): boolean {
    return this.auditingHelper.isEntityHistoryEnabled(entityType);
  }

  shouldSavePropertyHistory(entityType: Class, propertyName: string): boolean {
    if (DisableAuditingMetadata.get(entityType, propertyName) !== undefined) return false;
    return this.isEntityHistoryEnabled(entityType) || AuditedMetadata.get(entityType, propertyName) !== undefined;
  }

  createPropertyChanges(entityType: Class, changeType: EntityChangeType, snapshot: EntitySnapshot): EntityPropertyChangeInfo[] {
    const original = snapshot.original ?? {};
    const current = snapshot.current ?? {};
    const names = new Set([...Object.keys(original), ...Object.keys(current)]);
    const changes: EntityPropertyChangeInfo[] = [];
    for (const name of names) {
      if (!this.shouldSavePropertyHistory(entityType, name)) continue;
      const before = changeType === EntityChangeType.Created ? undefined : original[name];
      const after = changeType === EntityChangeType.Deleted ? undefined : current[name];
      if (typeof before === "function" || typeof after === "function") continue;
      if (isInstanceOfAny(before, this.options.ignoredTypes) || isInstanceOfAny(after, this.options.ignoredTypes)) continue;
      const originalValue = this.serializeValue(before);
      const newValue = this.serializeValue(after);
      if (changeType === EntityChangeType.Updated && originalValue === newValue) continue;

      const change = new EntityPropertyChangeInfo();
      change.propertyName = truncate(name, EntityPropertyChangeInfo.maxPropertyNameLength);
      change.propertyTypeFullName = truncate(typeNameOf(after ?? before), EntityPropertyChangeInfo.maxPropertyTypeFullNameLength);
      change.originalValue = originalValue;
      change.newValue = newValue;
      changes.push(change);
    }
    return changes;
  }

  createEntityChangeInfo(entity: object, changeType: EntityChangeType, changes: EntitySnapshot | readonly EntityPropertyChangeInfo[]): EntityChangeInfo | undefined {
    const entityType = entity.constructor as Class;
    if (!this.isEntityHistoryEnabled(entityType)) return undefined;

    const propertyChanges = Array.isArray(changes) ? [...(changes as readonly EntityPropertyChangeInfo[])] : this.createPropertyChanges(entityType, changeType, changes as EntitySnapshot);
    if (changeType === EntityChangeType.Updated && propertyChanges.length === 0) return undefined;

    const info = new EntityChangeInfo();
    info.changeTime = this.clock.now;
    info.changeType = changeType;
    info.entityEntry = entity;
    info.entityId = entityIdOf(entity);
    info.entityTypeFullName = entityType.name;
    info.entityTenantId = isMultiTenant(entity) ? (entity.tenantId ?? undefined) : undefined;
    info.propertyChanges = propertyChanges;
    return info;
  }

  addToCurrentAuditLog(entityChanges: Iterable<EntityChangeInfo>): boolean {
    const scope = this.auditingManager.current;
    if (!scope) return false;
    scope.log.entityChanges.push(...entityChanges);
    return true;
  }

  protected serializeValue(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = typeof value === "string" ? value : this.auditSerializer.serialize(value);
    return truncate(text, EntityPropertyChangeInfo.maxValueLength);
  }
}

function entityIdOf(entity: object): string | undefined {
  const id = (entity as { id?: unknown }).id;
  if (id === undefined || id === null) return undefined;
  return typeof id === "object" ? JSON.stringify(id) : String(id);
}

function typeNameOf(value: unknown): string {
  if (value === undefined || value === null) return "undefined";
  if (typeof value === "object") return value.constructor?.name ?? "object";
  return typeof value;
}
