/** Port of `FeatureValueConsts` (mutable defaults, like the .NET static properties). */
export const FeatureValueConsts = {
  /** Default value: 128 */
  maxNameLength: 128,
  /** Default value: 64 */
  maxProviderNameLength: 64,
  /** Default value: 64 */
  maxProviderKeyLength: 64,
  /** Default value: 128 */
  maxValueLength: 128,
};

/** Port of `FeatureDefinitionRecordConsts`. */
export const FeatureDefinitionRecordConsts = {
  maxNameLength: 128,
  maxDisplayNameLength: 256,
  maxDescriptionLength: 256,
  maxDefaultValueLength: 256,
  maxAllowedProvidersLength: 256,
  maxValueTypeLength: 2048,
};

/** Port of `FeatureGroupDefinitionRecordConsts`. */
export const FeatureGroupDefinitionRecordConsts = {
  maxNameLength: 128,
  maxDisplayNameLength: 256,
};
