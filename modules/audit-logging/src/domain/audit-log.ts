import type { Guid } from "@abp/core";
import { DisableAuditing } from "@abp/auditing";
import { AggregateRoot } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary } from "@abp/object-extending";
import { AuditLogConsts } from "../domain-shared/index.js";
import type { AuditLogAction } from "./audit-log-action.js";
import type { EntityChange } from "./entity-change.js";
import { truncateOrUndefined } from "./string-helpers.js";

/** The .NET constructor parameters of `AuditLog` as a named object (25 positional arguments are not idiomatic here). */
export interface AuditLogInit {
  id: Guid;
  applicationName?: string;
  tenantId?: Guid;
  tenantName?: string;
  userId?: Guid;
  userName?: string;
  executionTime: Date;
  executionDuration: number;
  clientIpAddress?: string;
  clientName?: string;
  clientId?: string;
  correlationId?: string;
  browserInfo?: string;
  httpMethod?: string;
  url?: string;
  httpStatusCode?: number;
  impersonatorUserId?: Guid;
  impersonatorUserName?: string;
  impersonatorTenantId?: Guid;
  impersonatorTenantName?: string;
  extraProperties?: ExtraPropertyDictionary;
  entityChanges?: EntityChange[];
  actions?: AuditLogAction[];
  exceptions?: string;
  comments?: string;
}

/** Port of `AuditLog`. Values longer than the `AuditLogConsts` limits are truncated like in .NET. */
@DisableAuditing()
export class AuditLog extends AggregateRoot<Guid> implements IMultiTenant {
  applicationName: string | undefined = undefined;
  userId: Guid | undefined = undefined;
  userName: string | undefined = undefined;
  tenantId: Guid | undefined = undefined;
  tenantName: string | undefined = undefined;
  impersonatorUserId: Guid | undefined = undefined;
  impersonatorUserName: string | undefined = undefined;
  impersonatorTenantId: Guid | undefined = undefined;
  impersonatorTenantName: string | undefined = undefined;
  executionTime!: Date;
  executionDuration = 0;
  clientIpAddress: string | undefined = undefined;
  clientName: string | undefined = undefined;
  clientId: string | undefined = undefined;
  correlationId: string | undefined = undefined;
  browserInfo: string | undefined = undefined;
  httpMethod: string | undefined = undefined;
  url: string | undefined = undefined;
  exceptions: string | undefined = undefined;
  comments: string | undefined = undefined;
  httpStatusCode: number | undefined = undefined;
  entityChanges: EntityChange[] = [];
  actions: AuditLogAction[] = [];

  constructor(init?: AuditLogInit) {
    super(init?.id);
    if (!init) return;
    this.applicationName = truncateOrUndefined(init.applicationName, AuditLogConsts.maxApplicationNameLength);
    this.tenantId = init.tenantId;
    this.tenantName = truncateOrUndefined(init.tenantName, AuditLogConsts.maxTenantNameLength);
    this.userId = init.userId;
    this.userName = truncateOrUndefined(init.userName, AuditLogConsts.maxUserNameLength);
    this.executionTime = init.executionTime;
    this.executionDuration = init.executionDuration;
    this.clientIpAddress = truncateOrUndefined(init.clientIpAddress, AuditLogConsts.maxClientIpAddressLength);
    this.clientName = truncateOrUndefined(init.clientName, AuditLogConsts.maxClientNameLength);
    this.clientId = truncateOrUndefined(init.clientId, AuditLogConsts.maxClientIdLength);
    this.correlationId = truncateOrUndefined(init.correlationId, AuditLogConsts.maxCorrelationIdLength);
    this.browserInfo = truncateOrUndefined(init.browserInfo, AuditLogConsts.maxBrowserInfoLength);
    this.httpMethod = truncateOrUndefined(init.httpMethod, AuditLogConsts.maxHttpMethodLength);
    this.url = truncateOrUndefined(init.url, AuditLogConsts.maxUrlLength);
    this.httpStatusCode = init.httpStatusCode;
    this.impersonatorUserId = init.impersonatorUserId;
    this.impersonatorUserName = truncateOrUndefined(init.impersonatorUserName, AuditLogConsts.maxUserNameLength);
    this.impersonatorTenantId = init.impersonatorTenantId;
    this.impersonatorTenantName = truncateOrUndefined(init.impersonatorTenantName, AuditLogConsts.maxTenantNameLength);
    this.extraProperties = init.extraProperties ?? new ExtraPropertyDictionary();
    this.entityChanges = init.entityChanges ?? [];
    this.actions = init.actions ?? [];
    this.exceptions = init.exceptions;
    this.comments = truncateOrUndefined(init.comments, AuditLogConsts.maxCommentsLength);
  }
}
