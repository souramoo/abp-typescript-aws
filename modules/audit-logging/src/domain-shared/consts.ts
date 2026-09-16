/* Ports of the `*Consts` classes: mutable statics like the .NET `{ get; set; }` properties. */

/** Port of `AuditLogConsts`. */
export class AuditLogConsts {
  /** Default value: 96 */
  static maxApplicationNameLength = 96;
  /** Default value: 64 */
  static maxClientIpAddressLength = 64;
  /** Default value: 128 */
  static maxClientNameLength = 128;
  /** Default value: 64 */
  static maxClientIdLength = 64;
  /** Default value: 64 */
  static maxCorrelationIdLength = 64;
  /** Default value: 512 */
  static maxBrowserInfoLength = 512;
  /** Default value: 256 */
  static maxCommentsLength = 256;
  /** Default value: 256 */
  static maxUrlLength = 256;
  /** Default value: 16 */
  static maxHttpMethodLength = 16;
  /** Default value: 256 */
  static maxUserNameLength = 256;
  /** Default value: 64 */
  static maxTenantNameLength = 64;
}

/** Port of `AuditLogActionConsts`. */
export class AuditLogActionConsts {
  /** Default value: 256 */
  static maxServiceNameLength = 256;
  /** Default value: 128 */
  static maxMethodNameLength = 128;
  /** Default value: 2000 */
  static maxParametersLength = 2000;
}

/** Port of `EntityChangeConsts`. */
export class EntityChangeConsts {
  /** Default value: 512 */
  static maxEntityTypeFullNameLength = 512;
  /** Default value: 128 */
  static maxEntityIdLength = 128;
}

/** Port of `EntityPropertyChangeConsts`. */
export class EntityPropertyChangeConsts {
  /** Default value: 512 */
  static maxNewValueLength = 512;
  /** Default value: 512 */
  static maxOriginalValueLength = 512;
  /** Default value: 128 */
  static maxPropertyNameLength = 128;
  /** Default value: 512 */
  static maxPropertyTypeFullNameLength = 512;
}

/** Port of `AuditLogExcelFileConsts`. */
export class AuditLogExcelFileConsts {
  /** Default value: 256 */
  static maxFileNameLength = 256;
}

/** Port of `AuditLoggingModuleExtensionConsts`. */
export const AuditLoggingModuleExtensionConsts = {
  ModuleName: "AuditLogging",
  EntityNames: {
    AuditLog: "AuditLog",
    AuditLogAction: "AuditLogAction",
    EntityChange: "EntityChange",
  },
} as const;
