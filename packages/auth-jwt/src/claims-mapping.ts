import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal } from "@abp/security";
import type { JWTPayload } from "jose";

/** Registered claims that are token metadata, not identity claims. */
const metadataClaims = new Set(["iss", "aud", "exp", "iat", "nbf", "jti", "token_use", "auth_time", "origin_jti", "event_id", "scope", "scp", "version"]);

function toClaimValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(toClaimValues);
  if (typeof value === "object") return [JSON.stringify(value)];
  return [String(value)];
}

/**
 * Port of the inbound claim type mapping (`AbpClaimsMapOptions` / `MapInboundClaims`): every payload member becomes
 * a claim, renamed through `claimMappings`; arrays (e.g. Cognito's `cognito:groups`) become one claim per value.
 */
export function payloadToClaims(payload: JWTPayload, claimMappings: ReadonlyMap<string, string>): Claim[] {
  const claims: Claim[] = [];
  const issuer = typeof payload.iss === "string" ? payload.iss : undefined;
  for (const [name, value] of Object.entries(payload)) {
    if (metadataClaims.has(name)) continue;
    const type = claimMappings.get(name) ?? name;
    for (const claimValue of toClaimValues(value)) {
      if (!claims.some((c) => c.type === type && c.value === claimValue)) claims.push(issuer ? new Claim(type, claimValue, undefined, issuer) : new Claim(type, claimValue));
    }
  }
  return claims;
}

export function createBearerPrincipal(claims: Iterable<Claim>, authenticationType: string): ClaimsPrincipal {
  return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType, AbpClaimTypes.userName, AbpClaimTypes.role));
}

/** Groups claims into a JWT payload: single values as strings, repeated types (roles) as arrays. */
export function claimsToPayload(claims: Iterable<Claim>): Record<string, string | string[]> {
  const payload: Record<string, string | string[]> = {};
  for (const claim of claims) {
    const existing = payload[claim.type];
    if (existing === undefined) payload[claim.type] = claim.value;
    else if (Array.isArray(existing)) existing.push(claim.value);
    else payload[claim.type] = [existing, claim.value];
  }
  return payload;
}
