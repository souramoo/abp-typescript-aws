/** Port of `PermissionGrantConsts`. */
export class PermissionGrantConsts {
  /** Default value: 64 */
  static maxProviderNameLength = 64;
  /** Default value: 64 */
  static maxProviderKeyLength = 64;
  /** Default value: 256 */
  static maxResourceNameLength = 256;
  /** Default value: 256 */
  static maxResourceKeyLength = 256;
}

/** Port of `PermissionDefinitionRecordConsts`. */
export class PermissionDefinitionRecordConsts {
  /** Default value: 128 */
  static maxNameLength = 128;
  static maxDisplayNameLength = 256;
  static maxProvidersLength = 128;
  static maxStateCheckersLength = 256;
  static maxResourceNameLength = 256;
  static maxManagementPermissionNameLength = 128;
}

/** Port of `PermissionGroupDefinitionRecordConsts`. */
export class PermissionGroupDefinitionRecordConsts {
  /** Default value: 128 */
  static maxNameLength = 128;
  static maxDisplayNameLength = 256;
}
