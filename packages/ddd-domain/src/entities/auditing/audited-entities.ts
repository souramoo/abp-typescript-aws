import type { Guid } from "@abp/core";
import type { IAuditedObject, IAuditedObjectWithUser, ICreationAuditedObject, ICreationAuditedObjectWithUser, IFullAuditedObject, IFullAuditedObjectWithUser } from "@abp/auditing";
import { AggregateRoot, Entity } from "../entity.js";

/* Ports of Volo.Abp.Domain.Entities.Auditing. Audit properties are declared as fields (initialised to `undefined`)
 * so `IAuditPropertySetter` detects them by presence. Only the keyed (`<TKey>`) classes are ported; composite-key
 * audited entities compose the audited interfaces on `EntityBase` themselves. */

/** Port of `CreationAuditedEntity<TKey>`. */
export abstract class CreationAuditedEntity<TKey> extends Entity<TKey> implements ICreationAuditedObject {
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;
}

/** Port of `CreationAuditedAggregateRoot<TKey>`. */
export abstract class CreationAuditedAggregateRoot<TKey> extends AggregateRoot<TKey> implements ICreationAuditedObject {
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;
}

/** Port of `AuditedEntity<TKey>`. */
export abstract class AuditedEntity<TKey> extends CreationAuditedEntity<TKey> implements IAuditedObject {
  lastModificationTime: Date | undefined = undefined;
  lastModifierId: Guid | undefined = undefined;
}

/** Port of `AuditedAggregateRoot<TKey>`. */
export abstract class AuditedAggregateRoot<TKey> extends CreationAuditedAggregateRoot<TKey> implements IAuditedObject {
  lastModificationTime: Date | undefined = undefined;
  lastModifierId: Guid | undefined = undefined;
}

/** Port of `FullAuditedEntity<TKey>`. */
export abstract class FullAuditedEntity<TKey> extends AuditedEntity<TKey> implements IFullAuditedObject {
  isDeleted = false;
  deleterId: Guid | undefined = undefined;
  deletionTime: Date | undefined = undefined;
}

/** Port of `FullAuditedAggregateRoot<TKey>`. */
export abstract class FullAuditedAggregateRoot<TKey> extends AuditedAggregateRoot<TKey> implements IFullAuditedObject {
  isDeleted = false;
  deleterId: Guid | undefined = undefined;
  deletionTime: Date | undefined = undefined;
}

/* The `...WithUser<TKey, TUser>` classes only add navigation properties; they are ported as interfaces. */

/** Port of `CreationAuditedEntityWithUser<TKey, TUser>` / `CreationAuditedAggregateRootWithUser<TKey, TUser>`. */
export interface ICreationAuditedEntityWithUser<TKey, TUser> extends CreationAuditedEntity<TKey>, ICreationAuditedObjectWithUser<TUser> {}
/** Port of `AuditedEntityWithUser<TKey, TUser>` / `AuditedAggregateRootWithUser<TKey, TUser>`. */
export interface IAuditedEntityWithUser<TKey, TUser> extends AuditedEntity<TKey>, IAuditedObjectWithUser<TUser> {}
/** Port of `FullAuditedEntityWithUser<TKey, TUser>` / `FullAuditedAggregateRootWithUser<TKey, TUser>`. */
export interface IFullAuditedEntityWithUser<TKey, TUser> extends FullAuditedEntity<TKey>, IFullAuditedObjectWithUser<TUser> {}

/** True when the entity class derives from one of the creation-audited base classes (used for default sorting). */
export function isCreationAuditedEntityType(type: unknown): boolean {
  if (typeof type !== "function") return false;
  const prototype = (type as { prototype: object }).prototype;
  return prototype instanceof CreationAuditedEntity || prototype instanceof CreationAuditedAggregateRoot;
}
