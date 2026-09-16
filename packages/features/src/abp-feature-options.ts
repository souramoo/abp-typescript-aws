import { TypeList } from "@abp/core";
import type { IFeatureDefinitionProvider } from "./feature-definition.js";
import type { IFeatureValueProvider } from "./feature-value-provider.js";

/** Port of `AbpFeatureOptions`. */
export class AbpFeatureOptions {
  readonly definitionProviders = new TypeList<IFeatureDefinitionProvider>();
  readonly valueProviders = new TypeList<IFeatureValueProvider>();
  readonly deletedFeatures = new Set<string>();
  readonly deletedFeatureGroups = new Set<string>();
}
