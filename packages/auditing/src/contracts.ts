import { AbpModule, createClassMarker, createMethodMetadata, type Class, type Guid, type ISoftDelete } from "@abp/core";

/* Port of Volo.Abp.Auditing.Contracts. Interfaces are erased at runtime, so the setters and history helpers
 * check property presence (`"creationTime" in entity`): declare the fields on your classes (even as undefined). */

/** Port of `IHasCreationTime`. */
export interface IHasCreationTime {
  creationTime: Date;
}
/** Port of `IMayHaveCreator`. */
export interface IMayHaveCreator {
  creatorId: Guid | undefined;
}
/** Port of `IMustHaveCreator`. */
export interface IMustHaveCreator {
  creatorId: Guid;
}
/** Port of `ICreationAuditedObject`. */
export interface ICreationAuditedObject extends IHasCreationTime, IMayHaveCreator {}
/** Port of `IHasModificationTime`. */
export interface IHasModificationTime {
  lastModificationTime: Date | undefined;
}
/** Port of `IModificationAuditedObject`. */
export interface IModificationAuditedObject extends IHasModificationTime {
  lastModifierId: Guid | undefined;
}
/** Port of `IAuditedObject`. */
export interface IAuditedObject extends ICreationAuditedObject, IModificationAuditedObject {}
/** Port of `IHasDeletionTime` (also makes the object soft-deletable). */
export interface IHasDeletionTime extends ISoftDelete {
  deletionTime: Date | undefined;
}
/** Port of `IDeletionAuditedObject`. */
export interface IDeletionAuditedObject extends IHasDeletionTime {
  deleterId: Guid | undefined;
}
/** Port of `IFullAuditedObject`. */
export interface IFullAuditedObject extends IAuditedObject, IDeletionAuditedObject {}
/** Port of `IHasEntityVersion`. */
export interface IHasEntityVersion {
  entityVersion: number;
}

/* Ports of the `<TUser>` navigation-property variants (`IMayHaveCreator<TCreator>` etc.). */
export interface IMayHaveCreatorWithUser<TCreator> extends IMayHaveCreator {
  creator: TCreator | undefined;
}
export interface IMustHaveCreatorWithUser<TCreator> extends IMustHaveCreator {
  creator: TCreator;
}
export interface ICreationAuditedObjectWithUser<TCreator> extends ICreationAuditedObject, IMayHaveCreatorWithUser<TCreator> {}
export interface IModificationAuditedObjectWithUser<TUser> extends IModificationAuditedObject {
  lastModifier: TUser | undefined;
}
export interface IDeletionAuditedObjectWithUser<TUser> extends IDeletionAuditedObject {
  deleter: TUser | undefined;
}
export interface IAuditedObjectWithUser<TUser> extends IAuditedObject, ICreationAuditedObjectWithUser<TUser>, IModificationAuditedObjectWithUser<TUser> {}
export interface IFullAuditedObjectWithUser<TUser> extends IAuditedObjectWithUser<TUser>, IFullAuditedObject, IDeletionAuditedObjectWithUser<TUser> {}

function hasProperty(value: unknown, name: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && name in value;
}

export function hasCreationTime(value: unknown): value is IHasCreationTime {
  return hasProperty(value, "creationTime");
}
/** `IMayHaveCreator` and `IMustHaveCreator` are indistinguishable at runtime: both declare `creatorId`. */
export function hasCreatorId(value: unknown): value is IMayHaveCreator | IMustHaveCreator {
  return hasProperty(value, "creatorId");
}
export function isCreationAuditedObject(value: unknown): value is ICreationAuditedObject {
  return hasCreationTime(value) && hasCreatorId(value);
}
export function hasModificationTime(value: unknown): value is IHasModificationTime {
  return hasProperty(value, "lastModificationTime");
}
export function isModificationAuditedObject(value: unknown): value is IModificationAuditedObject {
  return hasProperty(value, "lastModifierId");
}
export function hasDeletionTime(value: unknown): value is IHasDeletionTime {
  return hasProperty(value, "deletionTime");
}
export function isDeletionAuditedObject(value: unknown): value is IDeletionAuditedObject {
  return hasProperty(value, "deleterId");
}
export function hasEntityVersion(value: unknown): value is IHasEntityVersion {
  return hasProperty(value, "entityVersion") && typeof value["entityVersion"] === "number";
}

/** Port of `EntityChangeType`. */
export enum EntityChangeType {
  Created = 0,
  Updated = 1,
  Deleted = 2,
}

/** Port of the `IAuditingEnabled` marker interface: `@AuditingEnabled()` (inherited by subclasses). */
export const AuditingEnabled = createClassMarker("IAuditingEnabled");

/** Port of `DisableAuditingAttribute` properties. */
export interface DisableAuditingOptions {
  /** When false, changes to this entity property will not update audit properties (like `lastModificationTime`). Default: true. */
  updateModificationProps: boolean;
  /** When false, changes to this entity property will not publish entity change events. Default: true. */
  publishEntityEvent: boolean;
}

/** Metadata store behind `@Audited()`; `get(Type, member)` covers methods and properties, `getForClass` the class. */
export const AuditedMetadata = createMethodMetadata<true>("Audited");
/** Metadata store behind `@DisableAuditing()`. */
export const DisableAuditingMetadata = createMethodMetadata<DisableAuditingOptions>("DisableAuditing");

const auditedMembers = new WeakMap<object, Set<string>>();

function rememberMember(target: object, propertyKey: string | symbol): void {
  let set = auditedMembers.get(target);
  if (!set) {
    set = new Set();
    auditedMembers.set(target, set);
  }
  set.add(String(propertyKey));
}

/** Members (methods or properties) of a class or its bases decorated with `@Audited()`. */
export function getAuditedMembers(type: Class | undefined): string[] {
  const names = new Set<string>();
  let proto: unknown = type?.prototype;
  while (proto && proto !== Object.prototype) {
    for (const name of auditedMembers.get(proto as object) ?? []) names.add(name);
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

/** Port of `[Audited]`: on a class, a method or a property. */
export function Audited() {
  return (target: object, propertyKey?: string | symbol, _descriptor?: PropertyDescriptor): void => {
    if (propertyKey === undefined) {
      AuditedMetadata.setForClass(target as Class, true);
      return;
    }
    AuditedMetadata(true)(target, propertyKey);
    rememberMember(target, propertyKey);
  };
}

/** Port of `[DisableAuditing]`: on a class, a method or a property (parameters have no decorators in TypeScript). */
export function DisableAuditing(options: Partial<DisableAuditingOptions> = {}) {
  const value: DisableAuditingOptions = { updateModificationProps: true, publishEntityEvent: true, ...options };
  return (target: object, propertyKey?: string | symbol, _descriptor?: PropertyDescriptor): void => {
    if (propertyKey === undefined) DisableAuditingMetadata.setForClass(target as Class, value);
    else DisableAuditingMetadata(value)(target, propertyKey);
  };
}

/** Port of `AbpAuditingContractsModule`. */
export class AbpAuditingContractsModule extends AbpModule {}
