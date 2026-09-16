/** Port of `TenantManagementPermissions`. */
export const TenantManagementPermissions = {
  GroupName: "AbpTenantManagement",
  Tenants: {
    Default: "AbpTenantManagement.Tenants",
    Create: "AbpTenantManagement.Tenants.Create",
    Update: "AbpTenantManagement.Tenants.Update",
    Delete: "AbpTenantManagement.Tenants.Delete",
    ManageFeatures: "AbpTenantManagement.Tenants.ManageFeatures",
    ManageConnectionStrings: "AbpTenantManagement.Tenants.ManageConnectionStrings",
  },
  /** Port of `GetAll()` (`ReflectionHelper.GetPublicConstantsRecursively`). */
  getAll(): string[] {
    return Object.values(TenantManagementPermissions.Tenants);
  },
} as const;

/** Port of `TenantManagementRemoteServiceConsts`. */
export const TenantManagementRemoteServiceConsts = {
  RemoteServiceName: "AbpTenantManagement",
  ModuleName: "multi-tenancy",
} as const;
