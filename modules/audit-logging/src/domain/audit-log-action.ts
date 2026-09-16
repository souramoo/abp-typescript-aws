import type { Guid } from "@abp/core";
import { DisableAuditing, type AuditLogActionInfo } from "@abp/auditing";
import { Entity } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary, type IHasExtraProperties } from "@abp/object-extending";
import { AuditLogActionConsts } from "../domain-shared/index.js";
import { truncateFromBeginning } from "./string-helpers.js";

/** Port of `AuditLogAction`. */
@DisableAuditing()
export class AuditLogAction extends Entity<Guid> implements IMultiTenant, IHasExtraProperties {
  tenantId: Guid | undefined = undefined;
  auditLogId!: Guid;
  serviceName: string | undefined = undefined;
  methodName: string | undefined = undefined;
  parameters: string | undefined = undefined;
  executionTime!: Date;
  executionDuration = 0;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(id?: Guid, auditLogId?: Guid, actionInfo?: AuditLogActionInfo, tenantId?: Guid) {
    super(id);
    if (id === undefined || auditLogId === undefined || !actionInfo) return;
    this.tenantId = tenantId;
    this.auditLogId = auditLogId;
    this.executionTime = actionInfo.executionTime;
    this.executionDuration = actionInfo.executionDuration;
    this.extraProperties = new ExtraPropertyDictionary(actionInfo.extraProperties);
    this.serviceName = truncateFromBeginning(actionInfo.serviceName, AuditLogActionConsts.maxServiceNameLength);
    this.methodName = truncateFromBeginning(actionInfo.methodName, AuditLogActionConsts.maxMethodNameLength);
    this.parameters = actionInfo.parameters.length > AuditLogActionConsts.maxParametersLength ? "" : actionInfo.parameters;
  }
}
