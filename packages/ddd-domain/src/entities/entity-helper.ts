import { AbpException, Check, type AbstractClass, type Class, type Guid } from "@abp/core";
import { AsyncLocalCurrentTenantAccessor, isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { DisableIdGeneration, Entity, EntityBase, entityEquals, hasDefaultKeys, isDefaultKeyValue, isEntity, isEntityWithId, keysEqual, type IEntity, type IEntityBase } from "./entity.js";
import { ValueObject } from "../values/value-object.js";

function isEntityType(type: AbstractClass): boolean {
  return type.prototype instanceof EntityBase || typeof (type.prototype as { getKeys?: unknown }).getKeys === "function";
}

/** Port of `EntityHelper`. Type checks use prototypes since interfaces are erased. */
export const EntityHelper = {
  /** True when the entity class declares `tenantId` (checked on an instance; types are erased). */
  isMultiTenant(entityOrType: unknown): boolean {
    if (typeof entityOrType === "function") return "tenantId" in ((entityOrType as { prototype: object }).prototype ?? {});
    return isMultiTenant(entityOrType);
  },

  entityEquals,

  isEntity(type: AbstractClass): boolean {
    Check.notNull(type, "type");
    return isEntityType(type);
  },

  isValueObjectPredicate: (type: AbstractClass): boolean => type === ValueObject || type.prototype instanceof ValueObject,

  isValueObject(typeOrObject: AbstractClass | object | null | undefined): boolean {
    if (typeOrObject === null || typeOrObject === undefined) return false;
    const type = typeof typeOrObject === "function" ? (typeOrObject as AbstractClass) : (typeOrObject.constructor as AbstractClass);
    return EntityHelper.isValueObjectPredicate(type);
  },

  checkEntity(type: AbstractClass): void {
    Check.notNull(type, "type");
    if (!isEntityType(type)) throw new AbpException(`Given type is not an entity: ${type.name}. It must extend Entity or implement IEntity.`);
  },

  /** Port of `IsEntityWithId(type)`: the class extends `Entity<TKey>`; an instance qualifies when it exposes `id`. */
  isEntityWithId(entityOrType: unknown): boolean {
    if (typeof entityOrType === "function") return (entityOrType as { prototype: object }).prototype instanceof Entity;
    return isEntityWithId(entityOrType);
  },

  hasDefaultId<TKey>(entity: IEntity<TKey>): boolean {
    return isDefaultKeyValue(entity.id);
  },

  hasDefaultKeys(entity: IEntityBase): boolean {
    Check.notNull(entity, "entity");
    return hasDefaultKeys(entity);
  },

  /** Port of `CreateEqualityExpressionForId`: a predicate matching the entity with `id`. */
  createEqualityExpressionForId<TEntity extends IEntity<TKey>, TKey>(id: TKey): (entity: TEntity) => boolean {
    return (entity) => keysEqual(entity.id, id);
  },

  /** Port of `TrySetId`: assigns the id unless the class is `@DisableIdGeneration()` (when `checkForDisableIdGenerationAttribute`). */
  trySetId<TKey>(entity: IEntity<TKey>, idFactory: () => TKey, checkForDisableIdGenerationAttribute = false): void {
    if (checkForDisableIdGenerationAttribute && DisableIdGeneration.has(entity.constructor as Class)) return;
    (entity as { id: TKey }).id = idFactory();
  },

  /**
   * Port of `TrySetTenantId`. .NET runs it in the entity constructor; TypeScript field initializers run after the
   * base constructor, so repositories call it on insert and it only fills an unset `tenantId`.
   */
  trySetTenantId(entity: IEntityBase): void {
    if (!isMultiTenant(entity)) return;
    if (entity.tenantId !== undefined && entity.tenantId !== null) return;
    const tenantId = AsyncLocalCurrentTenantAccessor.instance.current?.tenantId;
    if (tenantId === undefined) return;
    (entity as { tenantId?: Guid | null }).tenantId = tenantId;
  },

  isEntityInstance: isEntity,
};
