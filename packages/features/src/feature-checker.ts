import { AbpException, Check, IServiceProviderToken, Transient, createToken, formatNamed, isNullOrEmptyString, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpAuthorizationException } from "@abp/security";
import { AbpFeatureOptions } from "./abp-feature-options.js";
import type { FeatureDefinition } from "./feature-definition.js";
import { IFeatureDefinitionManager } from "./feature-definition-store.js";
import { IFeatureValueProviderManager, type IFeatureValueProvider } from "./feature-value-provider.js";
import { abpFeatureEn } from "./localization/abp-feature-resource.js";

/** Port of `AbpFeatureErrorCodes`. */
export const AbpFeatureErrorCodes = {
  FeatureIsNotEnabled: "Volo.Feature:010001",
  AllOfTheseFeaturesMustBeEnabled: "Volo.Feature:010002",
  AtLeastOneOfTheseFeaturesMustBeEnabled: "Volo.Feature:010003",
} as const;

/** Port of `IFeatureChecker`. */
export interface IFeatureChecker {
  getOrNull(name: string): Promise<string | undefined>;
  isEnabled(name: string): Promise<boolean>;
  isEnabledMany(names: readonly string[]): Promise<Map<string, boolean>>;
}
export const IFeatureChecker = createToken<IFeatureChecker>("IFeatureChecker");

/** Port of `FeatureCheckerBase`. Concrete subclasses need their own `@Transient(IFeatureChecker)`. */
export abstract class FeatureCheckerBase implements IFeatureChecker {
  abstract getOrNull(name: string): Promise<string | undefined>;

  async isEnabled(name: string): Promise<boolean> {
    const value = await this.getOrNull(name);
    if (isNullOrEmptyString(value)) return false;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new AbpException(`The value '${value}' for the feature '${name}' should be a boolean, but was not!`);
  }

  async isEnabledMany(names: readonly string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    for (const name of names) result.set(name, await this.isEnabled(name));
    return result;
  }
}

/**
 * Port of `FeatureChecker`: value providers are consulted from the last registered to the first (tenant, edition,
 * configuration, default). Like .NET, the host simply gets whatever the providers return (usually the default value).
 */
@Transient(IFeatureChecker)
export class FeatureChecker extends FeatureCheckerBase {
  static readonly inject = [optionsToken(AbpFeatureOptions), IServiceProviderToken, IFeatureDefinitionManager, IFeatureValueProviderManager] as const;
  protected readonly options: AbpFeatureOptions;

  constructor(
    options: IOptions<AbpFeatureOptions>,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly featureDefinitionManager: IFeatureDefinitionManager,
    protected readonly featureValueProviderManager: IFeatureValueProviderManager,
  ) {
    super();
    this.options = options.value;
  }

  async getOrNull(name: string): Promise<string | undefined> {
    const featureDefinition = await this.featureDefinitionManager.getOrNull(name);
    if (!featureDefinition) return undefined;
    let providers = [...this.featureValueProviderManager.valueProviders].reverse();
    if (featureDefinition.allowedProviders.length > 0) providers = providers.filter((p) => featureDefinition.allowedProviders.includes(p.name));
    return this.getOrNullValueFromProviders(providers, featureDefinition);
  }

  protected async getOrNullValueFromProviders(providers: readonly IFeatureValueProvider[], feature: FeatureDefinition): Promise<string | undefined> {
    for (const provider of providers) {
      const value = await provider.getOrNull(feature);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }
}

/** Builds the `AbpAuthorizationException` of a failed feature check with the English message of `AbpFeatureResource`. */
export function createFeatureNotEnabledException(code: (typeof AbpFeatureErrorCodes)[keyof typeof AbpFeatureErrorCodes], data: Record<string, string>): AbpAuthorizationException {
  const exception = new AbpAuthorizationException(formatNamed(abpFeatureEn.texts[code] as string, data), code);
  for (const [name, value] of Object.entries(data)) exception.withData(name, value);
  return exception;
}

/** Port of `FeatureCheckerExtensions` as plain functions. */
export const FeatureCheckerExtensions = {
  /** `GetAsync<T>(name, defaultValue)`: `convert` replaces .NET's `value.To<T>()`. */
  async get<T>(featureChecker: IFeatureChecker, name: string, defaultValue: T, convert: (value: string) => T): Promise<T> {
    const value = await featureChecker.getOrNull(Check.notNull(name, "name"));
    return value === undefined ? defaultValue : convert(value);
  },
  getAsNumber(featureChecker: IFeatureChecker, name: string, defaultValue = 0): Promise<number> {
    return FeatureCheckerExtensions.get(featureChecker, name, defaultValue, (v) => {
      const parsed = Number(v);
      if (v.trim() === "" || Number.isNaN(parsed)) throw new TypeError(`'${v}' is not a valid number.`);
      return parsed;
    });
  },
  getAsBoolean(featureChecker: IFeatureChecker, name: string, defaultValue = false): Promise<boolean> {
    return FeatureCheckerExtensions.get(featureChecker, name, defaultValue, (v) => {
      const normalized = v.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      throw new TypeError(`'${v}' is not a valid boolean.`);
    });
  },
  /** `IsEnabledAsync(requiresAll, featureNames)`. */
  async isEnabled(featureChecker: IFeatureChecker, requiresAll: boolean, featureNames: readonly string[]): Promise<boolean> {
    if (featureNames.length === 0) return true;
    for (const featureName of featureNames) {
      const enabled = await featureChecker.isEnabled(featureName);
      if (requiresAll && !enabled) return false;
      if (!requiresAll && enabled) return true;
    }
    return requiresAll;
  },
  /** `CheckEnabledAsync(featureName)`: throws `AbpAuthorizationException` (`Volo.Feature:010001`) when disabled. */
  async checkEnabled(featureChecker: IFeatureChecker, featureName: string): Promise<void> {
    if (!(await featureChecker.isEnabled(featureName))) throw createFeatureNotEnabledException(AbpFeatureErrorCodes.FeatureIsNotEnabled, { FeatureName: featureName });
  },
  /** `CheckEnabledAsync(requiresAll, featureNames)`: throws `Volo.Feature:010002` / `010003` when the check fails. */
  async checkEnabledMany(featureChecker: IFeatureChecker, requiresAll: boolean, featureNames: readonly string[]): Promise<void> {
    if (featureNames.length === 0) return;
    if (await FeatureCheckerExtensions.isEnabled(featureChecker, requiresAll, featureNames)) return;
    const code = requiresAll ? AbpFeatureErrorCodes.AllOfTheseFeaturesMustBeEnabled : AbpFeatureErrorCodes.AtLeastOneOfTheseFeaturesMustBeEnabled;
    throw createFeatureNotEnabledException(code, { FeatureNames: featureNames.join(", ") });
  },
};
