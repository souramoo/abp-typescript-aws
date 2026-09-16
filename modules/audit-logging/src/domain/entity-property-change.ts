import type { Guid } from "@abp/core";
import { DisableAuditing, type EntityPropertyChangeInfo } from "@abp/auditing";
import { Entity } from "@abp/ddd-domain";
import type { IGuidGenerator } from "@abp/guids";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { EntityPropertyChangeConsts } from "../domain-shared/index.js";
import { truncateFromBeginning, truncateOrUndefined } from "./string-helpers.js";

/** Port of `EntityPropertyChange`. */
@DisableAuditing()
export class EntityPropertyChange extends Entity<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  entityChangeId!: Guid;
  newValue: string | undefined = undefined;
  originalValue: string | undefined = undefined;
  propertyName!: string;
  propertyTypeFullName!: string;

  constructor(guidGenerator?: IGuidGenerator, entityChangeId?: Guid, entityChangeInfo?: EntityPropertyChangeInfo, tenantId?: Guid) {
    super();
    if (!guidGenerator || entityChangeId === undefined || !entityChangeInfo) return;
    this.id = guidGenerator.create();
    this.tenantId = tenantId;
    this.entityChangeId = entityChangeId;
    this.newValue = truncateOrUndefined(entityChangeInfo.newValue, EntityPropertyChangeConsts.maxNewValueLength);
    this.originalValue = truncateOrUndefined(entityChangeInfo.originalValue, EntityPropertyChangeConsts.maxOriginalValueLength);
    this.propertyName = truncateFromBeginning(entityChangeInfo.propertyName, EntityPropertyChangeConsts.maxPropertyNameLength) ?? "";
    this.propertyTypeFullName = truncateFromBeginning(entityChangeInfo.propertyTypeFullName, EntityPropertyChangeConsts.maxPropertyTypeFullNameLength) ?? "";
  }
}
