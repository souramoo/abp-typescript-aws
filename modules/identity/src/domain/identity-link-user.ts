import type { Guid } from "@abp/core";
import { BasicAggregateRoot } from "@abp/ddd-domain";

/** Port of `IdentityLinkUserInfo`. */
export class IdentityLinkUserInfo {
  constructor(
    readonly userId: Guid,
    readonly tenantId: Guid | undefined = undefined,
  ) {}

  equals(other: IdentityLinkUserInfo): boolean {
    return this.userId === other.userId && (this.tenantId ?? undefined) === (other.tenantId ?? undefined);
  }
}

/** Port of `IdentityLinkUser`: a link between two user accounts (stored on the host side). */
export class IdentityLinkUser extends BasicAggregateRoot<Guid> {
  sourceUserId!: Guid;
  sourceTenantId: Guid | undefined = undefined;
  targetUserId!: Guid;
  targetTenantId: Guid | undefined = undefined;

  constructor(id?: Guid, sourceUser?: IdentityLinkUserInfo, targetUser?: IdentityLinkUserInfo) {
    super(id);
    if (id === undefined || !sourceUser || !targetUser) return;
    this.sourceUserId = sourceUser.userId;
    this.sourceTenantId = sourceUser.tenantId;
    this.targetUserId = targetUser.userId;
    this.targetTenantId = targetUser.tenantId;
  }

  get source(): IdentityLinkUserInfo {
    return new IdentityLinkUserInfo(this.sourceUserId, this.sourceTenantId);
  }

  get target(): IdentityLinkUserInfo {
    return new IdentityLinkUserInfo(this.targetUserId, this.targetTenantId);
  }

  /** True when the link connects `info` on either side. */
  involves(info: IdentityLinkUserInfo): boolean {
    return this.source.equals(info) || this.target.equals(info);
  }
}
