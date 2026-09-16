import { Guid, Transient, createToken } from "@abp/core";
import { ICurrentTenant, isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { ICurrentUser } from "@abp/security";
import { IClock } from "@abp/timing";
import { hasCreationTime, hasCreatorId, hasDeletionTime, hasEntityVersion, hasModificationTime, isDeletionAuditedObject, isModificationAuditedObject } from "./contracts.js";

/** Port of `IAuditPropertySetter`. */
export interface IAuditPropertySetter {
  setCreationProperties(targetObject: object): void;
  setModificationProperties(targetObject: object): void;
  setDeletionProperties(targetObject: object): void;
  incrementEntityVersionProperty(targetObject: object): void;
}
export const IAuditPropertySetter = createToken<IAuditPropertySetter>("IAuditPropertySetter");

/**
 * Port of `AuditPropertySetter`. Audit properties are detected by presence at runtime; a "not set" value is
 * `undefined`/`null` (the port of `default(DateTime)` / `null`). Unset ids become `undefined`, not `null`.
 */
@Transient(IAuditPropertySetter)
export class AuditPropertySetter implements IAuditPropertySetter {
  static readonly inject = [ICurrentUser, ICurrentTenant, IClock] as const;

  constructor(
    protected readonly currentUser: ICurrentUser,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly clock: IClock,
  ) {}

  setCreationProperties(targetObject: object): void {
    this.setCreationTime(targetObject);
    this.setCreatorId(targetObject);
  }

  setModificationProperties(targetObject: object): void {
    this.setLastModificationTime(targetObject);
    this.setLastModifierId(targetObject);
  }

  setDeletionProperties(targetObject: object): void {
    this.setDeletionTime(targetObject);
    this.setDeleterId(targetObject);
  }

  incrementEntityVersionProperty(targetObject: object): void {
    if (hasEntityVersion(targetObject)) targetObject.entityVersion = targetObject.entityVersion + 1;
  }

  protected setCreationTime(targetObject: object): void {
    if (!hasCreationTime(targetObject)) return;
    if (targetObject.creationTime === undefined || targetObject.creationTime === null) targetObject.creationTime = this.clock.now;
  }

  protected setCreatorId(targetObject: object): void {
    const userId = this.currentUser.id;
    if (userId === undefined) return;
    if (isMultiTenant(targetObject) && !Guid.equals(targetObject.tenantId, this.currentUser.tenantId)) return;
    if (!hasCreatorId(targetObject)) return;
    if (targetObject.creatorId !== undefined && targetObject.creatorId !== null && targetObject.creatorId !== Guid.empty) return;
    targetObject.creatorId = userId;
  }

  protected setLastModificationTime(targetObject: object): void {
    if (hasModificationTime(targetObject)) targetObject.lastModificationTime = this.clock.now;
  }

  protected setLastModifierId(targetObject: object): void {
    if (!isModificationAuditedObject(targetObject)) return;
    const userId = this.currentUser.id;
    if (userId === undefined) {
      targetObject.lastModifierId = undefined;
      return;
    }
    if (isMultiTenant(targetObject) && !Guid.equals(targetObject.tenantId, this.currentUser.tenantId)) {
      targetObject.lastModifierId = undefined;
      return;
    }
    targetObject.lastModifierId = userId;
  }

  protected setDeletionTime(targetObject: object): void {
    if (!hasDeletionTime(targetObject)) return;
    if (targetObject.deletionTime === undefined || targetObject.deletionTime === null) targetObject.deletionTime = this.clock.now;
  }

  protected setDeleterId(targetObject: object): void {
    if (!isDeletionAuditedObject(targetObject)) return;
    if (targetObject.deleterId !== undefined && targetObject.deleterId !== null) return;
    const userId = this.currentUser.id;
    if (userId === undefined) {
      targetObject.deleterId = undefined;
      return;
    }
    if (isMultiTenant(targetObject) && !Guid.equals(targetObject.tenantId, this.currentUser.tenantId)) {
      targetObject.deleterId = undefined;
      return;
    }
    targetObject.deleterId = userId;
  }
}
