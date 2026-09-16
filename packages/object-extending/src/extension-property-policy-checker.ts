import { Transient } from "@abp/core";
import type { ExtensionPropertyPolicyConfiguration } from "./extension-property-configurations.js";

/** Port of `ExtensionPropertyPolicyChecker`; feature/permission modules override the `check*Async` hooks. */
@Transient()
export class ExtensionPropertyPolicyChecker {
  async checkPolicyAsync(policy: ExtensionPropertyPolicyConfiguration): Promise<boolean> {
    if (!(await this.checkAsync(policy.globalFeatures.features, policy.globalFeatures.requiresAll, (n) => this.checkGlobalFeaturesAsync(n)))) return false;
    if (!(await this.checkAsync(policy.features.features, policy.features.requiresAll, (n) => this.checkFeaturesAsync(n)))) return false;
    return this.checkAsync(policy.permissions.permissionNames, policy.permissions.requiresAll, (n) => this.checkPermissionsAsync(n));
  }

  protected async checkAsync(names: readonly string[], requiresAll: boolean, checkFunc: (name: string) => Promise<boolean>): Promise<boolean> {
    if (names.length === 0) return true;
    let hasAny = false;
    for (const name of names) {
      if (!(await checkFunc(name))) {
        if (requiresAll) return false;
      } else {
        hasAny = true;
        if (!requiresAll) break;
      }
    }
    return hasAny;
  }

  protected async checkGlobalFeaturesAsync(_featureName: string): Promise<boolean> {
    return true;
  }
  protected async checkFeaturesAsync(_featureName: string): Promise<boolean> {
    return true;
  }
  protected async checkPermissionsAsync(_permissionName: string): Promise<boolean> {
    return true;
  }
}
