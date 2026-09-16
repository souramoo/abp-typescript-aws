import type { Guid } from "@abp/core";
import type { IAuditedObject, IAuditedObjectWithUser, ICreationAuditedObject, ICreationAuditedObjectWithUser, IFullAuditedObject, IFullAuditedObjectWithUser } from "@abp/auditing";
import { ExtensibleObject } from "@abp/object-extending";

/*
 * Ports of Volo.Abp.Application.Dtos entity DTOs. The keyless `EntityDto` becomes `EntityDtoBase` (a name cannot be
 * overloaded by type-parameter count); `EntityDto<TKey>` keeps its name. Audit fields are initialised to `undefined`
 * so the object mapper and validators see them.
 */

/** Port of `IEntityDto` / `IEntityDto<TKey>`. */
export interface IEntityDtoBase {
  readonly __entityDto?: true;
}
export interface IEntityDto<TKey> extends IEntityDtoBase {
  id: TKey;
}

export function isEntityDto(value: unknown): value is IEntityDto<unknown> {
  return typeof value === "object" && value !== null && "id" in value;
}

/** Port of the keyless `EntityDto`. */
export abstract class EntityDtoBase implements IEntityDtoBase {
  declare readonly __entityDto?: true;

  toString(): string {
    return `[DTO: ${this.constructor.name}]`;
  }
}

/** Port of `EntityDto<TKey>`. */
export abstract class EntityDto<TKey> extends EntityDtoBase implements IEntityDto<TKey> {
  id!: TKey;

  getObjectKey(): string | undefined {
    return this.id === undefined || this.id === null ? undefined : String(this.id);
  }

  override toString(): string {
    return `[DTO: ${this.constructor.name}] Id = ${String(this.id)}`;
  }
}

export abstract class CreationAuditedEntityDtoBase extends EntityDtoBase implements ICreationAuditedObject {
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;
}
export abstract class CreationAuditedEntityDto<TKey> extends EntityDto<TKey> implements ICreationAuditedObject {
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;
}
export abstract class CreationAuditedEntityWithUserDtoBase<TUserDto> extends CreationAuditedEntityDtoBase implements ICreationAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
}
export abstract class CreationAuditedEntityWithUserDto<TKey, TUserDto> extends CreationAuditedEntityDto<TKey> implements ICreationAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
}

export abstract class AuditedEntityDtoBase extends CreationAuditedEntityDtoBase implements IAuditedObject {
  lastModificationTime: Date | undefined = undefined;
  lastModifierId: Guid | undefined = undefined;
}
export abstract class AuditedEntityDto<TKey> extends CreationAuditedEntityDto<TKey> implements IAuditedObject {
  lastModificationTime: Date | undefined = undefined;
  lastModifierId: Guid | undefined = undefined;
}
export abstract class AuditedEntityWithUserDtoBase<TUserDto> extends AuditedEntityDtoBase implements IAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
}
export abstract class AuditedEntityWithUserDto<TKey, TUserDto> extends AuditedEntityDto<TKey> implements IAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
}

export abstract class FullAuditedEntityDtoBase extends AuditedEntityDtoBase implements IFullAuditedObject {
  isDeleted = false;
  deleterId: Guid | undefined = undefined;
  deletionTime: Date | undefined = undefined;
}
export abstract class FullAuditedEntityDto<TKey> extends AuditedEntityDto<TKey> implements IFullAuditedObject {
  isDeleted = false;
  deleterId: Guid | undefined = undefined;
  deletionTime: Date | undefined = undefined;
}
export abstract class FullAuditedEntityWithUserDtoBase<TUserDto> extends FullAuditedEntityDtoBase implements IFullAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
  deleter: TUserDto | undefined = undefined;
}
export abstract class FullAuditedEntityWithUserDto<TKey, TUserDto> extends FullAuditedEntityDto<TKey> implements IFullAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
  deleter: TUserDto | undefined = undefined;
}

/* Extensible variants (`IHasExtraProperties` through `ExtensibleObject`). */

/** Port of the keyless `ExtensibleEntityDto`. */
export abstract class ExtensibleEntityDtoBase extends ExtensibleObject implements IEntityDtoBase {
  declare readonly __entityDto?: true;

  constructor(setDefaultsForExtraProperties = true) {
    super(setDefaultsForExtraProperties);
  }
  override toString(): string {
    return `[DTO: ${this.constructor.name}]`;
  }
}

/** Port of `ExtensibleEntityDto<TKey>`. */
export abstract class ExtensibleEntityDto<TKey> extends ExtensibleObject implements IEntityDto<TKey> {
  id!: TKey;

  constructor(setDefaultsForExtraProperties = true) {
    super(setDefaultsForExtraProperties);
  }

  getObjectKey(): string | undefined {
    return this.id === undefined || this.id === null ? undefined : String(this.id);
  }

  override toString(): string {
    return `[DTO: ${this.constructor.name}] Id = ${String(this.id)}`;
  }
}

export abstract class ExtensibleCreationAuditedEntityDtoBase extends ExtensibleEntityDtoBase implements ICreationAuditedObject {
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;
}
export abstract class ExtensibleCreationAuditedEntityDto<TKey> extends ExtensibleEntityDto<TKey> implements ICreationAuditedObject {
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;
}
export abstract class ExtensibleCreationAuditedEntityWithUserDtoBase<TUserDto> extends ExtensibleCreationAuditedEntityDtoBase implements ICreationAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
}
export abstract class ExtensibleCreationAuditedEntityWithUserDto<TKey, TUserDto> extends ExtensibleCreationAuditedEntityDto<TKey> implements ICreationAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
}

export abstract class ExtensibleAuditedEntityDtoBase extends ExtensibleCreationAuditedEntityDtoBase implements IAuditedObject {
  lastModificationTime: Date | undefined = undefined;
  lastModifierId: Guid | undefined = undefined;
}
export abstract class ExtensibleAuditedEntityDto<TKey> extends ExtensibleCreationAuditedEntityDto<TKey> implements IAuditedObject {
  lastModificationTime: Date | undefined = undefined;
  lastModifierId: Guid | undefined = undefined;
}
export abstract class ExtensibleAuditedEntityWithUserDtoBase<TUserDto> extends ExtensibleAuditedEntityDtoBase implements IAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
}
export abstract class ExtensibleAuditedEntityWithUserDto<TKey, TUserDto> extends ExtensibleAuditedEntityDto<TKey> implements IAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
}

export abstract class ExtensibleFullAuditedEntityDtoBase extends ExtensibleAuditedEntityDtoBase implements IFullAuditedObject {
  isDeleted = false;
  deleterId: Guid | undefined = undefined;
  deletionTime: Date | undefined = undefined;
}
export abstract class ExtensibleFullAuditedEntityDto<TKey> extends ExtensibleAuditedEntityDto<TKey> implements IFullAuditedObject {
  isDeleted = false;
  deleterId: Guid | undefined = undefined;
  deletionTime: Date | undefined = undefined;
}
export abstract class ExtensibleFullAuditedEntityWithUserDtoBase<TUserDto> extends ExtensibleFullAuditedEntityDtoBase implements IFullAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
  deleter: TUserDto | undefined = undefined;
}
export abstract class ExtensibleFullAuditedEntityWithUserDto<TKey, TUserDto> extends ExtensibleFullAuditedEntityDto<TKey> implements IFullAuditedObjectWithUser<TUserDto> {
  creator: TUserDto | undefined = undefined;
  lastModifier: TUserDto | undefined = undefined;
  deleter: TUserDto | undefined = undefined;
}
