import { Check, createClassMarker, createMethodMetadata, type AbstractClass, type Class } from "@abp/core";
import { GlobalFeatureManager, getGlobalFeatureName, type GlobalFeatureRef } from "./global-feature-manager.js";

/** Port of the `IGlobalFeatureCheckingEnabled` marker interface: `@GlobalFeatureCheckingEnabled()` classes get the interceptor. */
export const GlobalFeatureCheckingEnabled = createClassMarker("IGlobalFeatureCheckingEnabled");

const requiresGlobalFeatureMetadata = createMethodMetadata<GlobalFeatureRef>("RequiresGlobalFeature");

/** Port of `[RequiresGlobalFeature(typeof(X))]` / `[RequiresGlobalFeature("X")]` on a class. */
export function RequiresGlobalFeature(feature: GlobalFeatureRef) {
  if (typeof feature === "string") Check.notNullOrWhiteSpace(feature, "name");
  else Check.notNull(feature, "type");
  return (target: AbstractClass): void => {
    requiresGlobalFeatureMetadata.setForClass(target as Class, feature);
  };
}

/** Port of `RequiresGlobalFeatureAttribute.GetFeatureName` for the attribute found on `type` (inherited). */
export function getRequiredGlobalFeatureName(type: Class | undefined): string | undefined {
  const feature = requiresGlobalFeatureMetadata.getForClass(type);
  if (feature === undefined) return undefined;
  return typeof feature === "string" ? feature : getGlobalFeatureName(feature);
}

/** Port of `GlobalFeatureHelper.IsGlobalFeatureEnabled`: true when the class needs no global feature or it is enabled. */
export function isGlobalFeatureEnabled(type: Class): { enabled: boolean; featureName: string | undefined } {
  const featureName = getRequiredGlobalFeatureName(type);
  return { enabled: featureName === undefined || GlobalFeatureManager.instance.isEnabled(featureName), featureName };
}
