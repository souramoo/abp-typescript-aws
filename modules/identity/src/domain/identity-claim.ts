import { Check, type Guid } from "@abp/core";
import { Entity } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { Claim } from "@abp/security";

/** Port of `IdentityClaim`: a stored claim (type + value) of a user or a role. */
export abstract class IdentityClaim extends Entity<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  claimType!: string;
  claimValue: string | undefined = undefined;

  protected constructor(id?: Guid, claimType?: string, claimValue?: string, tenantId?: Guid) {
    super(id);
    if (id === undefined) return;
    this.claimType = Check.notNull(claimType, "claimType");
    this.claimValue = claimValue;
    this.tenantId = tenantId;
  }

  toClaim(): Claim {
    return new Claim(this.claimType, this.claimValue ?? "");
  }

  setClaim(claim: Claim): void {
    Check.notNull(claim, "claim");
    this.claimType = claim.type;
    this.claimValue = claim.value;
  }
}

/** Port of `IdentityUserClaim`. */
export class IdentityUserClaim extends IdentityClaim {
  userId!: Guid;

  constructor(id?: Guid, userId?: Guid, claimType?: string, claimValue?: string, tenantId?: Guid) {
    super(id, claimType, claimValue, tenantId);
    if (userId !== undefined) this.userId = userId;
  }

  static fromClaim(id: Guid, userId: Guid, claim: Claim, tenantId: Guid | undefined): IdentityUserClaim {
    return new IdentityUserClaim(id, userId, claim.type, claim.value, tenantId);
  }
}

/** Port of `IdentityRoleClaim`. */
export class IdentityRoleClaim extends IdentityClaim {
  roleId!: Guid;

  constructor(id?: Guid, roleId?: Guid, claimType?: string, claimValue?: string, tenantId?: Guid) {
    super(id, claimType, claimValue, tenantId);
    if (roleId !== undefined) this.roleId = roleId;
  }

  static fromClaim(id: Guid, roleId: Guid, claim: Claim, tenantId: Guid | undefined): IdentityRoleClaim {
    return new IdentityRoleClaim(id, roleId, claim.type, claim.value, tenantId);
  }
}

/** True when a stored claim equals the given claim by type and value. */
export function claimMatches(stored: { claimType: string; claimValue: string | undefined }, claim: Claim): boolean {
  return stored.claimType === claim.type && (stored.claimValue ?? "") === claim.value;
}
