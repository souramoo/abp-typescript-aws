import type { Guid } from "@abp/core";
import { DisableAuditing, EntityChangeType, type EntityChangeInfo } from "@abp/auditing";
import { Entity } from "@abp/ddd-domain";
import type { IGuidGenerator } from "@abp/guids";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary, type IHasExtraProperties } from "@abp/object-extending";
import { EntityChangeConsts } from "../domain-shared/index.js";
import { EntityPropertyChange } from "./entity-property-change.js";
import { truncateFromBeginning, truncateOrUndefined } from "./string-helpers.js";

/** Port of `EntityChange`. */
@DisableAuditing()
export class EntityChange extends Entity<Guid> implements IMultiTenant, IHasExtraProperties {
  auditLogId!: Guid;
  tenantId: Guid | undefined = undefined;
  changeTime!: Date;
  changeType: EntityChangeType = EntityChangeType.Created;
  entityTenantId: Guid | undefined = undefined;
  entityId: string | undefined = undefined;
  entityTypeFullName!: string;
  propertyChanges: EntityPropertyChange[] = [];
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(guidGenerator?: IGuidGenerator, auditLogId?: Guid, entityChangeInfo?: EntityChangeInfo, tenantId?: Guid) {
    super();
    if (!guidGenerator || auditLogId === undefined || !entityChangeInfo) return;
    this.id = guidGenerator.create();
    this.auditLogId = auditLogId;
    this.tenantId = tenantId;
    this.changeTime = entityChangeInfo.changeTime;
    this.changeType = entityChangeInfo.changeType;
    this.entityTenantId = entityChangeInfo.entityTenantId;
    this.entityId = truncateOrUndefined(entityChangeInfo.entityId, EntityChangeConsts.maxEntityIdLength);
    this.entityTypeFullName = truncateFromBeginning(entityChangeInfo.entityTypeFullName, EntityChangeConsts.maxEntityTypeFullNameLength) ?? "";
    this.propertyChanges = entityChangeInfo.propertyChanges.map((p) => new EntityPropertyChange(guidGenerator, this.id, p, tenantId));
    this.extraProperties = new ExtraPropertyDictionary(entityChangeInfo.extraProperties);
  }
}

/** Port of `EntityChangeWithUsername`. */
export class EntityChangeWithUsername {
  constructor(
    public entityChange: EntityChange,
    public userName: string | undefined,
  ) {}
}
