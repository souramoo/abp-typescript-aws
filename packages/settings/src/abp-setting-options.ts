import { TypeList } from "@abp/core";
import type { ISettingDefinitionProvider } from "./setting-definition.js";
import type { ISettingValueProvider } from "./setting-value-provider.js";

/** Port of `AbpSettingOptions`. */
export class AbpSettingOptions {
  readonly definitionProviders = new TypeList<ISettingDefinitionProvider>();
  readonly valueProviders = new TypeList<ISettingValueProvider>();
  readonly deletedSettings = new Set<string>();
  /** Default: true. Keeps the stored value readable after `SettingDefinition.isEncrypted` was switched on later. */
  returnOriginalValueIfDecryptFailed = true;
}
