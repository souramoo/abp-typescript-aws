/** Port of `SettingConsts` (mutable defaults, like the .NET static properties). */
export const SettingConsts = {
  /** Default value: 128 */
  maxNameLength: 128,
  /** Default value: 2048 */
  maxValueLength: 2048,
  maxValueLengthValue: 2048,
  /** Default value: 64 */
  maxProviderNameLength: 64,
  /** Default value: 64 */
  maxProviderKeyLength: 64,
};

/** Port of `SettingDefinitionRecordConsts`. */
export const SettingDefinitionRecordConsts = {
  maxNameLength: 128,
  maxDisplayNameLength: 256,
  maxDescriptionLength: 512,
  maxDefaultValueLength: SettingConsts.maxValueLengthValue,
  maxProvidersLength: 1024,
};
