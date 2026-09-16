import { AbpException, Check, Guid, type AbstractClass, type Class } from "@abp/core";
import { NamedTypeSelector } from "@abp/auditing";
import { EtoBase, EventNameAttribute, type IEventDataMayHaveTenantId, type MultiTenantEventDataInfo } from "@abp/event-bus";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { EntityBase, isEntity } from "../../entity.js";

/** Port of `IEntityEto<TKey>`. */
export interface IEntityEto<TKey> {
  id: TKey;
}

/**
 * Port of `EntityEto` (the ETO used when no mapping is configured). Besides the .NET members it carries the `id`
 * and `tenantId` of the entity so consumers can locate it without parsing `keysAsString`.
 */
export class EntityEto extends EtoBase {
  entityType!: string;
  keysAsString!: string;
  id: unknown = undefined;
  tenantId: Guid | undefined = undefined;

  constructor(entityType?: string, keysAsString?: string) {
    super();
    if (entityType !== undefined) this.entityType = entityType;
    if (keysAsString !== undefined) this.keysAsString = keysAsString;
  }
}

/** Port of `EntityEto<TKey>` (base class for custom ETOs). */
export abstract class EntityEtoOf<TKey> implements IEntityEto<TKey> {
  id!: TKey;
}

const etoTypeTag = Symbol("EntityEto.etoType");

/**
 * Port of the `EntityCreatedEto<TEntityEto>` family. As with `EntityEventData`, `EntityCreatedEto.of(BookEto)` is
 * the closed class; its event name is `<eto event name>.Created` (port of `[GenericEventName(Postfix = ".Created")]`).
 */
export abstract class EntityEtoEventBase<TEntityEto = object> implements IEventDataMayHaveTenantId {
  constructor(public entity: TEntityEto) {}

  isMultiTenant(): MultiTenantEventDataInfo {
    if (isMultiTenant(this.entity)) return { isMultiTenant: true, tenantId: this.entity.tenantId ?? undefined };
    return { isMultiTenant: false };
  }

  static etoTypeOf(eventType: AbstractClass): AbstractClass | undefined {
    return (eventType.prototype as Record<symbol, AbstractClass | undefined>)[etoTypeTag];
  }
}

export type EntityEtoEventClass<TEntityEto = object> = Class<EntityEtoEventBase<TEntityEto>>;

export class EntityCreatedEto<TEntityEto = object> extends EntityEtoEventBase<TEntityEto> {
  static readonly postfix = ".Created";
  static of<TEntityEto extends object>(etoType: AbstractClass<TEntityEto>): EntityEtoEventClass<TEntityEto> {
    return closedEtoEventClass(EntityCreatedEto, etoType, EntityCreatedEto.postfix);
  }
}

export class EntityUpdatedEto<TEntityEto = object> extends EntityEtoEventBase<TEntityEto> {
  static readonly postfix = ".Updated";
  static of<TEntityEto extends object>(etoType: AbstractClass<TEntityEto>): EntityEtoEventClass<TEntityEto> {
    return closedEtoEventClass(EntityUpdatedEto, etoType, EntityUpdatedEto.postfix);
  }
}

export class EntityDeletedEto<TEntityEto = object> extends EntityEtoEventBase<TEntityEto> {
  static readonly postfix = ".Deleted";
  static of<TEntityEto extends object>(etoType: AbstractClass<TEntityEto>): EntityEtoEventClass<TEntityEto> {
    return closedEtoEventClass(EntityDeletedEto, etoType, EntityDeletedEto.postfix);
  }
}

const closedEtoClasses = new WeakMap<object, Map<AbstractClass, EntityEtoEventClass>>();

function closedEtoEventClass<TEntityEto extends object>(openType: EntityEtoEventClass, etoType: AbstractClass<TEntityEto>, postfix: string): EntityEtoEventClass<TEntityEto> {
  let byEto = closedEtoClasses.get(openType);
  if (!byEto) {
    byEto = new Map();
    closedEtoClasses.set(openType, byEto);
  }
  const existing = byEto.get(etoType);
  if (existing) return existing as EntityEtoEventClass<TEntityEto>;

  const closed = class extends openType {} as EntityEtoEventClass<TEntityEto>;
  Object.defineProperty(closed, "name", { value: `${openType.name}<${etoType.name}>` });
  Object.defineProperty(closed.prototype, etoTypeTag, { value: etoType, enumerable: false });
  EventNameAttribute.setProvider(closed, { getName: () => EventNameAttribute.getNameOrDefault(etoType) + postfix });
  byEto.set(etoType, closed);
  return closed;
}

/* Options (port of Volo.Abp.Ddd.Domain.Shared). */

/** Port of `AutoEntityDistributedEventSelectorList` (+ its extension methods). */
export class AutoEntityDistributedEventSelectorList extends Array<NamedTypeSelector> {
  static readonly AllEntitiesSelectorName = "All";

  /** Adds a specific entity class and the classes derived from it. */
  addEntity(entityType: AbstractClass): this {
    const selectorName = `Entity:${entityType.name}`;
    if (this.some((s) => s.name === selectorName)) return this;
    this.push(new NamedTypeSelector(selectorName, (t) => t === entityType || t.prototype instanceof entityType));
    return this;
  }

  /** Removes a specific entity class (added with `addEntity`). */
  removeEntity(entityType: AbstractClass): this {
    return this.removeByName(`Entity:${entityType.name}`), this;
  }

  /** Adds all entity classes. */
  addAll(): this {
    if (this.some((s) => s.name === AutoEntityDistributedEventSelectorList.AllEntitiesSelectorName)) return this;
    this.push(new NamedTypeSelector(AutoEntityDistributedEventSelectorList.AllEntitiesSelectorName, (t) => t.prototype instanceof EntityBase || isEntity(t.prototype)));
    return this;
  }

  /** `add(EntityClass)`, `add(predicate)` or `add(name, predicate)`. */
  add(entityType: AbstractClass): this;
  add(predicate: (type: Class) => boolean): this;
  add(selectorName: string, predicate: (type: Class) => boolean): this;
  add(first: AbstractClass | ((type: Class) => boolean) | string, predicate?: (type: Class) => boolean): this {
    if (typeof first === "string") {
      const selectorPredicate = Check.notNull(predicate, "predicate");
      if (this.some((s) => s.name === first)) throw new AbpException(`There is already a selector added before with the same name: ${first}`);
      this.push(new NamedTypeSelector(first, selectorPredicate));
      return this;
    }
    if (isClassLike(first)) return this.addEntity(first);
    return this.add(Guid.newGuid().replace(/-/g, ""), first as (type: Class) => boolean);
  }

  removeByName(name: string): boolean {
    Check.notNull(name, "name");
    let removed = false;
    for (let i = this.length - 1; i >= 0; i--) {
      if (this[i]!.name === name) {
        this.splice(i, 1);
        removed = true;
      }
    }
    return removed;
  }

  isMatch(entityType: Class): boolean {
    return this.some((s) => s.predicate(entityType));
  }
}

function isClassLike(value: unknown): value is AbstractClass {
  return typeof value === "function" && /^class\s/.test(Function.prototype.toString.call(value));
}

/** Port of `EtoMappingDictionaryItem`. */
export class EtoMappingDictionaryItem {
  constructor(
    readonly etoType: Class,
    readonly objectMappingContextType?: Class,
  ) {}
}

/** Port of `EtoMappingDictionary`. */
export class EtoMappingDictionary extends Map<AbstractClass, EtoMappingDictionaryItem> {
  add(entityType: AbstractClass, etoType: Class, objectMappingContextType?: Class): this {
    this.set(entityType, new EtoMappingDictionaryItem(etoType, objectMappingContextType));
    return this;
  }
}

/** Port of `AbpDistributedEntityEventOptions`. */
export class AbpDistributedEntityEventOptions {
  readonly autoEventSelectors = new AutoEntityDistributedEventSelectorList();
  readonly ignoredEventSelectors = new AutoEntityDistributedEventSelectorList();
  etoMappings = new EtoMappingDictionary();
}
