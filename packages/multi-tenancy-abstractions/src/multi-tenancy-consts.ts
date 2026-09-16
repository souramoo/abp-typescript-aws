/** Port of `MultiTenancySides` (flags: `Tenant | Host === Both`). */
export enum MultiTenancySides {
  Tenant = 1,
  Host = 2,
  Both = 3,
}

export function hasMultiTenancySide(sides: MultiTenancySides, side: MultiTenancySides): boolean {
  return (sides & side) === side;
}

/** Port of `MultiTenancyDatabaseStyle` (flags). */
export enum MultiTenancyDatabaseStyle {
  Shared = 1,
  PerTenant = 2,
  Hybrid = 3,
}

/** Port of `TenantUserSharingStrategy`. */
export enum TenantUserSharingStrategy {
  Isolated = 0,
  Shared = 1,
}

/** Port of `AbpMultiTenancyOptions`. */
export class AbpMultiTenancyOptions {
  /** A central point to enable/disable multi-tenancy. Default: false. */
  isEnabled = false;
  databaseStyle: MultiTenancyDatabaseStyle = MultiTenancyDatabaseStyle.Hybrid;
  userSharingStrategy: TenantUserSharingStrategy = TenantUserSharingStrategy.Isolated;
}

/** Port of `TenantResolverConsts`. */
export const TenantResolverConsts = {
  defaultTenantKey: "__tenant",
} as const;

/** Port of `TenantResolverNames`. */
export const TenantResolverNames = {
  fallbackTenant: "FallbackTenant",
} as const;

/** Common multi-tenancy constants (the `TenantId` property name shared by `IMultiTenant` entities and filters). */
export const MultiTenancyConsts = {
  tenantIdPropertyName: "tenantId",
  defaultTenantKey: TenantResolverConsts.defaultTenantKey,
} as const;
