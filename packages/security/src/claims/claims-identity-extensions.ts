import { Guid, isNullOrWhiteSpace } from "@abp/core";
import { AbpClaimTypes } from "./abp-claim-types.js";
import { type Claim, ClaimsIdentity, ClaimsPrincipal } from "./claims.js";
import type { ICurrentUser } from "../users/current-user.js";

/**
 * Port of `AbpClaimsIdentityExtensions` and the claim lookups of `CurrentUserExtensions` as plain functions.
 * .NET overloads them per receiver type (principal / identity / current user); here one function accepts all three.
 */
export type ClaimsHolder = ClaimsPrincipal | ClaimsIdentity | ICurrentUser;

function findClaim(holder: ClaimsHolder, claimType: string): Claim | undefined {
  return holder instanceof ClaimsPrincipal || holder instanceof ClaimsIdentity ? holder.findFirst(claimType) : holder.findClaim(claimType);
}

export function findClaimValue(holder: ClaimsHolder, claimType: string): string | undefined {
  const value = findClaim(holder, claimType)?.value;
  return isNullOrWhiteSpace(value) ? undefined : value;
}

function findGuidClaim(holder: ClaimsHolder, claimType: string): Guid | undefined {
  const value = findClaimValue(holder, claimType);
  return value !== undefined && Guid.isValid(value) ? Guid.parse(value) : undefined;
}

export function findUserId(holder: ClaimsHolder): Guid | undefined {
  return findGuidClaim(holder, AbpClaimTypes.userId);
}

export function findTenantId(holder: ClaimsHolder): Guid | undefined {
  return findGuidClaim(holder, AbpClaimTypes.tenantId);
}

export function findClientId(holder: ClaimsHolder): string | undefined {
  return findClaimValue(holder, AbpClaimTypes.clientId);
}

export function findEditionId(holder: ClaimsHolder): Guid | undefined {
  return findGuidClaim(holder, AbpClaimTypes.editionId);
}

export function findImpersonatorTenantId(holder: ClaimsHolder): Guid | undefined {
  return findGuidClaim(holder, AbpClaimTypes.impersonatorTenantId);
}

export function findImpersonatorUserId(holder: ClaimsHolder): Guid | undefined {
  return findGuidClaim(holder, AbpClaimTypes.impersonatorUserId);
}

export function findSessionId(holder: ClaimsHolder): string | undefined {
  return findClaimValue(holder, AbpClaimTypes.sessionId);
}

export function findImpersonatorTenantName(holder: ClaimsHolder): string | undefined {
  return findClaimValue(holder, AbpClaimTypes.impersonatorTenantName);
}

export function findImpersonatorUserName(holder: ClaimsHolder): string | undefined {
  return findClaimValue(holder, AbpClaimTypes.impersonatorUserName);
}

export function addIfNotContains(identity: ClaimsIdentity, claim: Claim): ClaimsIdentity {
  if (!identity.claims.some((c) => c.type.toLowerCase() === claim.type.toLowerCase())) identity.addClaim(claim);
  return identity;
}

export function removeAll(identity: ClaimsIdentity, claimType: string): ClaimsIdentity {
  for (const claim of identity.findAll(claimType)) identity.removeClaim(claim);
  return identity;
}

export function addOrReplace(identity: ClaimsIdentity, claim: Claim): ClaimsIdentity {
  removeAll(identity, claim.type);
  identity.addClaim(claim);
  return identity;
}

export function addIdentityIfNotContains(principal: ClaimsPrincipal, identity: ClaimsIdentity): ClaimsPrincipal {
  const exists = principal.identities.some((x) => (x.authenticationType ?? "").toLowerCase() === (identity.authenticationType ?? "").toLowerCase());
  if (!exists) principal.addIdentity(identity);
  return principal;
}
