import { truncate, type Guid } from "@abp/core";
import { AggregateRoot } from "@abp/ddd-domain";
import type { IGuidGenerator } from "@abp/guids";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { SecurityLogInfo } from "@abp/security";
import { IdentitySecurityLogConsts } from "../domain-shared/index.js";

function truncated(value: string | undefined, maxLength: number): string | undefined {
  return value === undefined ? undefined : truncate(value, maxLength);
}

/** Port of `IdentitySecurityLog`: a persisted `SecurityLogInfo`. */
export class IdentitySecurityLog extends AggregateRoot<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  applicationName: string | undefined = undefined;
  identity: string | undefined = undefined;
  action: string | undefined = undefined;
  userId: Guid | undefined = undefined;
  userName: string | undefined = undefined;
  tenantName: string | undefined = undefined;
  clientId: string | undefined = undefined;
  correlationId: string | undefined = undefined;
  clientIpAddress: string | undefined = undefined;
  browserInfo: string | undefined = undefined;
  creationTime!: Date;

  constructor(guidGenerator?: IGuidGenerator, securityLogInfo?: SecurityLogInfo) {
    super(guidGenerator?.create());
    if (!securityLogInfo) return;
    this.tenantId = securityLogInfo.tenantId;
    this.tenantName = truncated(securityLogInfo.tenantName, IdentitySecurityLogConsts.maxTenantNameLength);
    this.applicationName = truncated(securityLogInfo.applicationName, IdentitySecurityLogConsts.maxApplicationNameLength);
    this.identity = truncated(securityLogInfo.identity, IdentitySecurityLogConsts.maxIdentityLength);
    this.action = truncated(securityLogInfo.action, IdentitySecurityLogConsts.maxActionLength);
    this.userId = securityLogInfo.userId;
    this.userName = truncated(securityLogInfo.userName, IdentitySecurityLogConsts.maxUserNameLength);
    this.creationTime = securityLogInfo.creationTime;
    this.clientIpAddress = truncated(securityLogInfo.clientIpAddress, IdentitySecurityLogConsts.maxClientIpAddressLength);
    this.clientId = truncated(securityLogInfo.clientId, IdentitySecurityLogConsts.maxClientIdLength);
    this.correlationId = truncated(securityLogInfo.correlationId, IdentitySecurityLogConsts.maxCorrelationIdLength);
    this.browserInfo = truncated(securityLogInfo.browserInfo, IdentitySecurityLogConsts.maxBrowserInfoLength);
    for (const [key, value] of securityLogInfo.extraProperties) this.extraProperties.set(key, value);
  }
}
