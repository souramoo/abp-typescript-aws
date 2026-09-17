import { Check, removeAll, type Guid } from "@abp/core";
import { AggregateRoot } from "@abp/ddd-domain";
import type { IGuidGenerator } from "@abp/guids";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { Claim } from "@abp/security";
import { IdentityRoleNameChangedEto } from "../domain-shared/index.js";
import { IdentityRoleClaim, claimMatches } from "./identity-claim.js";

/** Port of `IdentityRole`. `name`/`normalizedName` are written by `IdentityRoleManager` (the store port). */
export class IdentityRole extends AggregateRoot<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  name!: string;
  normalizedName!: string;
  claims: IdentityRoleClaim[] = [];
  isDefault = false;
  isStatic = false;
  isPublic = false;
  entityVersion = 0;
  creationTime!: Date;

  constructor(id?: Guid, name?: string, tenantId?: Guid) {
    super(id);
    if (id === undefined) return;
    this.name = Check.notNull(name, "name");
    this.tenantId = tenantId;
    this.normalizedName = this.name.toUpperCase();
  }

  addClaim(guidGenerator: IGuidGenerator, claim: Claim): void {
    Check.notNull(guidGenerator, "guidGenerator");
    Check.notNull(claim, "claim");
    this.claims.push(IdentityRoleClaim.fromClaim(guidGenerator.create(), this.id, claim, this.tenantId));
  }

  addClaims(guidGenerator: IGuidGenerator, claims: Iterable<Claim>): void {
    for (const claim of Check.notNull(claims, "claims")) this.addClaim(guidGenerator, claim);
  }

  findClaim(claim: Claim): IdentityRoleClaim | undefined {
    Check.notNull(claim, "claim");
    return this.claims.find((c) => claimMatches(c, claim));
  }

  removeClaim(claim: Claim): void {
    Check.notNull(claim, "claim");
    removeAll(this.claims, (c) => claimMatches(c, claim));
  }

  /** Renames the role and records the `IdentityRoleNameChangedEto` distributed event (the obsolete local event is not ported). */
  changeName(name: string): void {
    Check.notNullOrWhiteSpace(name, "name");
    const oldName = this.name;
    this.name = name;
    const eto = new IdentityRoleNameChangedEto();
    eto.id = this.id;
    eto.name = this.name;
    eto.oldName = oldName;
    eto.tenantId = this.tenantId;
    this.addDistributedEvent(eto);
  }

  override toString(): string {
    return `${super.toString()}, Name = ${this.name}`;
  }
}

/** Port of `IdentityRoleWithUserCount`. */
export class IdentityRoleWithUserCount {
  constructor(
    readonly role: IdentityRole,
    readonly userCount: number,
  ) {}
}

/** Port of `IdentityUserIdWithRoleNames`. */
export interface IdentityUserIdWithRoleNames {
  id: Guid;
  roleNames: string[];
}
