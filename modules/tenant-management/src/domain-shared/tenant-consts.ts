/** Port of `TenantConsts` (mutable statics, like the .NET properties). */
export class TenantConsts {
  /** Default value: 64 */
  static maxNameLength = 64;
  /** Default value: 128 */
  static maxPasswordLength = 128;
  /** Default value: 256 */
  static maxAdminEmailAddressLength = 256;
}

/** Port of `TenantConnectionStringConsts`. */
export class TenantConnectionStringConsts {
  /** Default value: 64 */
  static maxNameLength = 64;
  /** Default value: 1024 */
  static maxValueLength = 1024;
}

/** Port of `TenantManagementModuleExtensionConsts`. */
export const TenantManagementModuleExtensionConsts = {
  ModuleName: "TenantManagement",
  EntityNames: {
    Tenant: "Tenant",
  },
} as const;
