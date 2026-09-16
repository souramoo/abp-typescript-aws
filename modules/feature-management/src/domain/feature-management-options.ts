import { TypeList } from "@abp/core";
import type { IFeatureManagementProvider } from "./feature-management-provider.js";

/** Port of `FeatureManagementOptions`. */
export class FeatureManagementOptions {
  readonly providers = new TypeList<IFeatureManagementProvider>();
  /** Authorization policy required to get/set the features of a provider, by provider name. */
  readonly providerPolicies = new Map<string, string>();
  /** Default: true. */
  saveStaticFeaturesToDatabase = true;
  /** Default: false. */
  isDynamicFeatureStoreEnabled = false;
  /**
   * Default: false. .NET saves the static features in a background task with a long retry policy; a Lambda container
   * is frozen between invocations, so the port awaits a single attempt during initialization unless this is set.
   */
  initializeInBackground = false;
}
