import { findTenantId, type ClaimsIdentity, type ClaimsPrincipal } from "@abp/security";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";

/** Port of `AbpMultiTenancyClaimsIdentityExtensions.GetMultiTenancySide`. */
export function getMultiTenancySideOf(principalOrIdentity: ClaimsPrincipal | ClaimsIdentity): MultiTenancySides {
  return findTenantId(principalOrIdentity) !== undefined ? MultiTenancySides.Tenant : MultiTenancySides.Host;
}
