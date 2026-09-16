import { AbpException, Transient, createToken, type Guid } from "@abp/core";
import { AbpClaimTypes } from "../claims/abp-claim-types.js";
import type { Claim } from "../claims/claims.js";
import { findClaimValue, findSessionId, findTenantId, findUserId } from "../claims/claims-identity-extensions.js";
import { ICurrentPrincipalAccessor } from "../claims/current-principal-accessor.js";

/** Port of `ICurrentUser`. */
export interface ICurrentUser {
  readonly isAuthenticated: boolean;
  readonly id: Guid | undefined;
  readonly userName: string | undefined;
  readonly name: string | undefined;
  readonly surName: string | undefined;
  readonly phoneNumber: string | undefined;
  readonly phoneNumberVerified: boolean;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
  readonly tenantId: Guid | undefined;
  readonly roles: string[];
  findClaim(claimType: string): Claim | undefined;
  findClaims(claimType: string): Claim[];
  getAllClaims(): Claim[];
  isInRole(roleName: string): boolean;
}
export const ICurrentUser = createToken<ICurrentUser>("ICurrentUser");

@Transient(ICurrentUser)
export class CurrentUser implements ICurrentUser {
  static readonly inject = [ICurrentPrincipalAccessor] as const;

  constructor(private readonly principalAccessor: ICurrentPrincipalAccessor) {}

  get isAuthenticated(): boolean {
    return this.id !== undefined;
  }
  get id(): Guid | undefined {
    return findUserId(this.principalAccessor.principal);
  }
  get userName(): string | undefined {
    return findClaimValue(this, AbpClaimTypes.userName);
  }
  get name(): string | undefined {
    return findClaimValue(this, AbpClaimTypes.name);
  }
  get surName(): string | undefined {
    return findClaimValue(this, AbpClaimTypes.surName);
  }
  get phoneNumber(): string | undefined {
    return findClaimValue(this, AbpClaimTypes.phoneNumber);
  }
  get phoneNumberVerified(): boolean {
    return findClaimValue(this, AbpClaimTypes.phoneNumberVerified)?.toLowerCase() === "true";
  }
  get email(): string | undefined {
    return findClaimValue(this, AbpClaimTypes.email);
  }
  get emailVerified(): boolean {
    return findClaimValue(this, AbpClaimTypes.emailVerified)?.toLowerCase() === "true";
  }
  get tenantId(): Guid | undefined {
    return findTenantId(this.principalAccessor.principal);
  }
  get roles(): string[] {
    return [...new Set(this.findClaims(AbpClaimTypes.role).map((c) => c.value))];
  }

  findClaim(claimType: string): Claim | undefined {
    return this.principalAccessor.principal.findFirst(claimType);
  }
  findClaims(claimType: string): Claim[] {
    return this.principalAccessor.principal.findAll(claimType);
  }
  getAllClaims(): Claim[] {
    return this.principalAccessor.principal.claims;
  }
  isInRole(roleName: string): boolean {
    return this.findClaims(AbpClaimTypes.role).some((c) => c.value === roleName);
  }
}

/* Port of the remaining `CurrentUserExtensions` (claim lookups live in `claims-identity-extensions.ts`). */

export function getId(currentUser: ICurrentUser): Guid {
  if (currentUser.id === undefined) throw new AbpException("Current user is not authenticated: id is not available.");
  return currentUser.id;
}

export function getSessionId(currentUser: ICurrentUser): string {
  const sessionId = findSessionId(currentUser);
  if (sessionId === undefined) throw new AbpException("Current user has no session id claim.");
  return sessionId;
}
