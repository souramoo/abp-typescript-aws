import { Check, type IHasSimpleStateCheckers, type ISimpleStateChecker } from "@abp/core";
import { GlobalFeatureManager, getGlobalFeatureName, type GlobalFeatureRef } from "./global-feature-manager.js";

/** Port of `RequireGlobalFeaturesSimpleStateChecker`. */
export class RequireGlobalFeaturesSimpleStateChecker<TState extends IHasSimpleStateCheckers<TState>> implements ISimpleStateChecker<TState> {
  readonly globalFeatureNames: readonly string[];

  constructor(
    readonly requiresAll: boolean,
    globalFeatures: readonly GlobalFeatureRef[],
  ) {
    this.globalFeatureNames = Check.notNullOrEmptyArray(globalFeatures, "globalFeatureNames").map((f) => (typeof f === "string" ? f : getGlobalFeatureName(f)));
  }

  async isEnabled(): Promise<boolean> {
    const enabled = (name: string) => GlobalFeatureManager.instance.isEnabled(name);
    return this.requiresAll ? this.globalFeatureNames.every(enabled) : this.globalFeatureNames.some(enabled);
  }
}

/** Port of `GlobalFeatureSimpleStateCheckerExtensions.RequireGlobalFeatures`. */
export function requireGlobalFeatures<TState extends IHasSimpleStateCheckers<TState>>(state: TState, globalFeatures: readonly GlobalFeatureRef[], requiresAll = true): TState {
  Check.notNull(state, "state");
  Check.notNullOrEmptyArray(globalFeatures, "globalFeatures");
  state.stateCheckers.push(new RequireGlobalFeaturesSimpleStateChecker<TState>(requiresAll, globalFeatures));
  return state;
}
