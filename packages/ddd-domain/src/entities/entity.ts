import { Guid, createClassMarker, type AbstractClass, type Class } from "@abp/core";
import { EventOrderGenerator } from "@abp/uow";
import { ExtraPropertyDictionary, setDefaultsForExtraProperties, type IHasExtraProperties } from "@abp/object-extending";
import type { IHasConcurrencyStamp } from "@abp/data";

/**
 * Port of `IEntity` (composite / non-`Id` keys). The keyed `IEntity<TKey>` of .NET is {@link IEntity} here; the
 * runtime cannot overload a name by type-parameter count, so the keyless variants carry a `Base` suffix.
 */
export interface IEntityBase {
  /** Returns an array of ordered keys for this entity. */
  getKeys(): readonly unknown[];
  /** Port of `IKeyedObject.GetObjectKey`. */
  getObjectKey(): string | undefined;
  entityEquals(other: IEntityBase | null | undefined): boolean;
}

/** Port of `IEntity<TKey>`: an entity with a single primary key named `id`. */
export interface IEntity<TKey = unknown> extends IEntityBase {
  readonly id: TKey;
}

/** The key type of an entity class (`IEntity<TKey>` → `TKey`). */
export type EntityKeyOf<TEntity> = TEntity extends IEntity<infer TKey> ? TKey : never;

/** Port of `IAggregateRoot` (keyless) and `IAggregateRoot<TKey>`. */
export interface IAggregateRootBase extends IEntityBase {
  readonly __aggregateRoot?: true;
}
export interface IAggregateRoot<TKey = unknown> extends IEntity<TKey>, IAggregateRootBase {}

export function isEntity(value: unknown): value is IEntityBase {
  return typeof value === "object" && value !== null && typeof (value as IEntityBase).getKeys === "function";
}

export function isEntityWithId(value: unknown): value is IEntity {
  return isEntity(value) && "id" in value;
}

/** Port of `ConcurrencyStampConsts`. */
export const ConcurrencyStampConsts = {
  MaxLength: 40,
} as const;

/** Port of `[DisableIdGeneration]`: repositories do not generate an id for the marked entity class. */
export const DisableIdGeneration = createClassMarker("DisableIdGeneration");

/** Port of `DomainEventRecord`. */
export class DomainEventRecord {
  constructor(
    readonly eventData: object,
    readonly eventOrder: number,
  ) {}
}

/** Port of `IGeneratesDomainEvents`. */
export interface IGeneratesDomainEvents {
  getLocalEvents(): readonly DomainEventRecord[];
  getDistributedEvents(): readonly DomainEventRecord[];
  clearLocalEvents(): void;
  clearDistributedEvents(): void;
}

export function generatesDomainEvents(value: unknown): value is IGeneratesDomainEvents {
  return typeof value === "object" && value !== null && typeof (value as IGeneratesDomainEvents).getLocalEvents === "function" && typeof (value as IGeneratesDomainEvents).getDistributedEvents === "function";
}

/** Port of `KeyedObjectHelper.EncodeCompositeKey`. */
export function encodeCompositeKey(keys: readonly unknown[]): string {
  return keys.map((k) => encodeURIComponent(k === undefined || k === null ? "" : String(k))).join(";");
}

/**
 * Port of the keyless `Entity` (composite keys). `EntityHelper.TrySetTenantId` cannot run in the constructor here
 * because subclass field initializers run after it; repositories apply it on insert instead.
 */
export abstract class EntityBase implements IEntityBase {
  abstract getKeys(): readonly unknown[];

  getObjectKey(): string | undefined {
    const keys = this.getKeys();
    if (keys.length === 0) return undefined;
    if (keys.length === 1) return keys[0] === undefined || keys[0] === null ? undefined : String(keys[0]);
    return encodeCompositeKey(keys);
  }

  entityEquals(other: IEntityBase | null | undefined): boolean {
    return entityEquals(this, other);
  }

  toString(): string {
    return `[ENTITY: ${this.constructor.name}] Keys = ${this.getKeys().join(", ")}`;
  }
}

/**
 * Port of `Entity<TKey>`. `id` is a plain public field (the .NET `protected set` has no field equivalent);
 * `EntityHelper.trySetId` is the sanctioned way for infrastructure to assign it.
 */
export abstract class Entity<TKey> extends EntityBase implements IEntity<TKey> {
  id!: TKey;

  constructor(id?: TKey) {
    super();
    if (id !== undefined) this.id = id;
  }

  override getKeys(): readonly unknown[] {
    return [this.id];
  }

  override toString(): string {
    return `[ENTITY: ${this.constructor.name}] Id = ${String(this.id)}`;
  }
}

/* Domain events live outside the entity instance so they never serialize with it and clones never carry them. */
const localEvents = new WeakMap<object, DomainEventRecord[]>();
const distributedEvents = new WeakMap<object, DomainEventRecord[]>();

function eventsOf(store: WeakMap<object, DomainEventRecord[]>, owner: object): DomainEventRecord[] {
  let list = store.get(owner);
  if (!list) {
    list = [];
    store.set(owner, list);
  }
  return list;
}

/** Port of the keyless `BasicAggregateRoot`. */
export abstract class BasicAggregateRootBase extends EntityBase implements IAggregateRootBase, IGeneratesDomainEvents {
  getLocalEvents(): readonly DomainEventRecord[] {
    return localEvents.get(this) ?? [];
  }
  getDistributedEvents(): readonly DomainEventRecord[] {
    return distributedEvents.get(this) ?? [];
  }
  clearLocalEvents(): void {
    localEvents.delete(this);
  }
  clearDistributedEvents(): void {
    distributedEvents.delete(this);
  }
  protected addLocalEvent(eventData: object): void {
    eventsOf(localEvents, this).push(new DomainEventRecord(eventData, EventOrderGenerator.getNext()));
  }
  protected addDistributedEvent(eventData: object): void {
    eventsOf(distributedEvents, this).push(new DomainEventRecord(eventData, EventOrderGenerator.getNext()));
  }
}

/** Port of `BasicAggregateRoot<TKey>`. */
export abstract class BasicAggregateRoot<TKey> extends Entity<TKey> implements IAggregateRoot<TKey>, IGeneratesDomainEvents {
  getLocalEvents(): readonly DomainEventRecord[] {
    return localEvents.get(this) ?? [];
  }
  getDistributedEvents(): readonly DomainEventRecord[] {
    return distributedEvents.get(this) ?? [];
  }
  clearLocalEvents(): void {
    localEvents.delete(this);
  }
  clearDistributedEvents(): void {
    distributedEvents.delete(this);
  }
  protected addLocalEvent(eventData: object): void {
    eventsOf(localEvents, this).push(new DomainEventRecord(eventData, EventOrderGenerator.getNext()));
  }
  protected addDistributedEvent(eventData: object): void {
    eventsOf(distributedEvents, this).push(new DomainEventRecord(eventData, EventOrderGenerator.getNext()));
  }
}

export function newConcurrencyStamp(): string {
  return Guid.newGuid().replace(/-/g, "");
}

/** Port of the keyless `AggregateRoot` (extra properties + concurrency stamp). */
export abstract class AggregateRootBase extends BasicAggregateRootBase implements IHasExtraProperties, IHasConcurrencyStamp {
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();
  concurrencyStamp: string = newConcurrencyStamp();

  constructor() {
    super();
    setDefaultsForExtraProperties(this, new.target as unknown as Class);
  }
}

/** Port of `AggregateRoot<TKey>` (extra properties + concurrency stamp). */
export abstract class AggregateRoot<TKey> extends BasicAggregateRoot<TKey> implements IHasExtraProperties, IHasConcurrencyStamp {
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();
  concurrencyStamp: string = newConcurrencyStamp();

  constructor(id?: TKey) {
    super(id);
    setDefaultsForExtraProperties(this, new.target as unknown as Class);
  }
}

/** Port of `EntityHelper.EntityEquals` (kept in this module to avoid a cycle with the base classes). */
export function entityEquals(entity1: IEntityBase | null | undefined, entity2: IEntityBase | null | undefined): boolean {
  if (!entity1 || !entity2) return false;
  if (entity1 === entity2) return true;

  const type1 = entity1.constructor as AbstractClass;
  const type2 = entity2.constructor as AbstractClass;
  if (!(entity1 instanceof type2) && !(entity2 instanceof type1)) return false;

  if ("tenantId" in entity1 && "tenantId" in entity2) {
    const tenant1 = (entity1 as { tenantId?: unknown }).tenantId ?? undefined;
    const tenant2 = (entity2 as { tenantId?: unknown }).tenantId ?? undefined;
    if (tenant1 !== tenant2) {
      if (tenant1 === undefined || tenant2 === undefined) return false;
      if (!keysEqual(tenant1, tenant2)) return false;
    }
  }

  if (hasDefaultKeys(entity1) && hasDefaultKeys(entity2)) return false;

  const keys1 = entity1.getKeys();
  const keys2 = entity2.getKeys();
  if (keys1.length !== keys2.length) return false;

  for (let i = 0; i < keys1.length; i++) {
    const key1 = keys1[i];
    const key2 = keys2[i];
    if (key1 === undefined || key1 === null) {
      if (key2 === undefined || key2 === null) continue;
      return false;
    }
    if (key2 === undefined || key2 === null) return false;
    if (isDefaultKeyValue(key1) && isDefaultKeyValue(key2)) return false;
    if (!keysEqual(key1, key2)) return false;
  }
  return true;
}

/** Port of `TypeHelper.IsDefaultValue` for key values (`0`/negative numbers count as unset, like ABP's EF workaround). */
export function isDefaultKeyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return value <= 0;
  if (typeof value === "bigint") return value <= 0n;
  if (typeof value === "string") return value === "" || value === Guid.empty;
  if (value instanceof Date) return value.getTime() === 0;
  return false;
}

export function hasDefaultKeys(entity: IEntityBase): boolean {
  return entity.getKeys().every(isDefaultKeyValue);
}

/** Key equality: guids compare case-insensitively, dates by instant, everything else strictly. */
export function keysEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string" && Guid.isValid(a) && Guid.isValid(b)) return Guid.equals(a, b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return false;
}
