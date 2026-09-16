import { TypeList } from "@abp/core";
import type { ISettingManagementProvider } from "./setting-management-provider.js";

/** Port of `SettingManagementOptions`. */
export class SettingManagementOptions {
  readonly providers = new TypeList<ISettingManagementProvider>();
  /** Default: true. */
  saveStaticSettingsToDatabase = true;
  /** Default: false. */
  isDynamicSettingStoreEnabled = false;
  /**
   * Default: false. .NET saves the static settings in a background task with a long retry policy; a Lambda container
   * is frozen between invocations, so the port awaits a single attempt during initialization unless this is set.
   */
  initializeInBackground = false;
}
