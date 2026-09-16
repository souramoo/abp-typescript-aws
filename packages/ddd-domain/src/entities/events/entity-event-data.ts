import type { AbstractClass, Class, Guid } from "@abp/core";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { IEventDataMayHaveTenantId, MultiTenantEventDataInfo } from "@abp/event-bus";

const entityTypeTag = Symbol("EntityEventData.entityType");

/**
 * Port of `EntityEventData<TEntity>`. Generic type arguments are erased, so `EntityCreatedEventData.of(Book)` builds
 * (and caches) the closed class `EntityCreatedEventData<Book>`; subscribing to it receives only `Book` events while
 * subscribing to the open `EntityCreatedEventData` receives events of every entity, like ABP's generic handlers.
 */
export class EntityEventData<TEntity = object> implements IEventDataMayHaveTenantId {
  constructor(readonly entity: TEntity) {}

  isMultiTenant(): MultiTenantEventDataInfo {
    if (isMultiTenant(this.entity)) return { isMultiTenant: true, tenantId: this.entity.tenantId ?? undefined };
    return { isMultiTenant: false };
  }

  /** The closed generic `EntityEventData<TEntity>` class for `entityType`. */
  static of<TEntity extends object>(this: EntityEventClass<TEntity>, entityType: AbstractClass<TEntity>): EntityEventClass<TEntity> {
    return closedEventClass(this, entityType);
  }

  /** The entity class a closed event class was created for (undefined for the open generic classes). */
  static entityTypeOf(eventType: AbstractClass): AbstractClass | undefined {
    return (eventType.prototype as Record<symbol, AbstractClass | undefined>)[entityTypeTag];
  }
}

/** Port of `EntityChangedEventData<TEntity>`: created, updated or deleted. */
export class EntityChangedEventData<TEntity = object> extends EntityEventData<TEntity> {}

/** Port of `EntityCreatedEventData<TEntity>`. */
export class EntityCreatedEventData<TEntity = object> extends EntityChangedEventData<TEntity> {}

/** Port of `EntityUpdatedEventData<TEntity>`. */
export class EntityUpdatedEventData<TEntity = object> extends EntityChangedEventData<TEntity> {}

/** Port of `EntityDeletedEventData<TEntity>`. */
export class EntityDeletedEventData<TEntity = object> extends EntityChangedEventData<TEntity> {}

export type EntityEventClass<TEntity = object> = Class<EntityEventData<TEntity>> & { readonly prototype: EntityEventData<TEntity> };

const closedClasses = new WeakMap<object, Map<AbstractClass, EntityEventClass>>();

/**
 * Builds the closed class. `instanceof` (also on prototypes, which is how `LocalEventBus` matches subclasses) is
 * redefined so that `EntityCreatedEventData.of(Book)` is an `EntityChangedEventData.of(Book)`, mirroring the .NET
 * inheritance between the closed generic types.
 */
function closedEventClass<TEntity extends object>(openType: EntityEventClass<TEntity>, entityType: AbstractClass<TEntity>): EntityEventClass<TEntity> {
  let byEntity = closedClasses.get(openType);
  if (!byEntity) {
    byEntity = new Map();
    closedClasses.set(openType, byEntity);
  }
  const existing = byEntity.get(entityType);
  if (existing) return existing as EntityEventClass<TEntity>;

  const closed = class extends openType {} as EntityEventClass<TEntity>;
  Object.defineProperty(closed, "name", { value: `${openType.name}<${entityType.name}>` });
  Object.defineProperty(closed.prototype, entityTypeTag, { value: entityType, enumerable: false });
  Object.defineProperty(closed, Symbol.hasInstance, {
    value: (value: unknown): boolean => typeof value === "object" && value !== null && Object.prototype.isPrototypeOf.call(openType.prototype, value) && (value as Record<symbol, unknown>)[entityTypeTag] === entityType,
  });
  byEntity.set(entityType, closed);
  return closed;
}

export function entityEventTenantId(eventData: EntityEventData): Guid | undefined {
  const info = eventData.isMultiTenant();
  return info.isMultiTenant ? info.tenantId : undefined;
}
