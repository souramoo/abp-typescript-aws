import { AbpException, Check, IServiceProviderToken, IStringLocalizerFactory, Singleton, createToken, optionsToken, type Guid, type IOptions, type IServiceProvider } from "@abp/core";
import { ConfigurationFeatureValueProvider, DefaultValueFeatureValueProvider, EditionFeatureValueProvider, IFeatureDefinitionManager, TenantFeatureValueProvider } from "@abp/features";
import { FeatureValueInvalidException } from "../domain-shared/index.js";
import { FeatureManagementOptions } from "./feature-management-options.js";
import type { IFeatureManagementProvider } from "./feature-management-provider.js";
import { FeatureNameValue, FeatureNameValueWithGrantedProvider, FeatureValueProviderInfo } from "./feature-name-value.js";

/** Port of `IFeatureManager`. */
export interface IFeatureManager {
  getOrNull(name: string, providerName: string, providerKey: string | undefined, fallback?: boolean): Promise<string | undefined>;
  getAll(providerName: string, providerKey: string | undefined, fallback?: boolean): Promise<FeatureNameValue[]>;
  getOrNullWithProvider(name: string, providerName: string, providerKey: string | undefined, fallback?: boolean): Promise<FeatureNameValueWithGrantedProvider>;
  getAllWithProvider(providerName: string, providerKey: string | undefined, fallback?: boolean): Promise<FeatureNameValueWithGrantedProvider[]>;
  /** A `value` of undefined clears the feature for the provider. */
  set(name: string, value: string | undefined, providerName: string, providerKey: string | undefined, forceToSet?: boolean): Promise<void>;
  /** Clears every value of the provider/key pair. */
  delete(providerName: string, providerKey: string | undefined): Promise<void>;
}
export const IFeatureManager = createToken<IFeatureManager>("IFeatureManager");

function skipWhile<T>(items: readonly T[], predicate: (item: T) => boolean): T[] {
  const index = items.findIndex((item) => !predicate(item));
  return index < 0 ? [] : items.slice(index);
}

function takeWhile<T>(items: readonly T[], predicate: (item: T) => boolean): T[] {
  const index = items.findIndex((item) => !predicate(item));
  return index < 0 ? [...items] : items.slice(0, index);
}

/**
 * Port of `FeatureManager`. Providers are consulted from the most specific (last registered) one down to the
 * defaults; a value is validated against the definition's `valueType` before it is stored.
 */
@Singleton(IFeatureManager)
export class FeatureManager implements IFeatureManager {
  static readonly inject = [optionsToken(FeatureManagementOptions), IServiceProviderToken, IFeatureDefinitionManager, IStringLocalizerFactory] as const;
  protected readonly options: FeatureManagementOptions;
  private resolvedProviders: IFeatureManagementProvider[] | undefined;

  constructor(
    options: IOptions<FeatureManagementOptions>,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly featureDefinitionManager: IFeatureDefinitionManager,
    protected readonly stringLocalizerFactory: IStringLocalizerFactory,
  ) {
    this.options = options.value;
  }

  protected get providers(): readonly IFeatureManagementProvider[] {
    this.resolvedProviders ??= this.options.providers.toArray().map((type) => this.serviceProvider.getRequired(type));
    return this.resolvedProviders;
  }

  async getOrNull(name: string, providerName: string, providerKey: string | undefined, fallback = true): Promise<string | undefined> {
    Check.notNull(name, "name");
    Check.notNull(providerName, "providerName");
    return (await this.getOrNullInternal(name, providerName, providerKey, fallback)).value;
  }

  async getAll(providerName: string, providerKey: string | undefined, fallback = true): Promise<FeatureNameValue[]> {
    return (await this.getAllWithProvider(providerName, providerKey, fallback)).map((x) => new FeatureNameValue(x.name, x.value));
  }

  async getOrNullWithProvider(name: string, providerName: string, providerKey: string | undefined, fallback = true): Promise<FeatureNameValueWithGrantedProvider> {
    Check.notNull(name, "name");
    Check.notNull(providerName, "providerName");
    return this.getOrNullInternal(name, providerName, providerKey, fallback);
  }

  async getAllWithProvider(providerName: string, providerKey: string | undefined, fallback = true): Promise<FeatureNameValueWithGrantedProvider[]> {
    Check.notNull(providerName, "providerName");

    const featureDefinitions = await this.featureDefinitionManager.getAll();
    let providers = skipWhile([...this.providers].reverse(), (p) => p.name !== providerName);
    if (!fallback) providers = takeWhile(providers, (p) => p.name === providerName);
    if (providers.length === 0) return [];

    const featureValues = new Map<string, FeatureNameValueWithGrantedProvider>();
    for (const feature of featureDefinitions) {
      const featureProviderList = feature.allowedProviders.length > 0 ? providers.filter((p) => feature.allowedProviders.includes(p.name)) : providers;
      if (featureProviderList.length === 0) continue;

      const featureNameValueWithGrantedProvider = new FeatureNameValueWithGrantedProvider(feature.name, undefined);
      for (const provider of featureProviderList) {
        const pk = provider.compatible(providerName) ? providerKey : undefined;
        const value = await provider.getOrNull(feature, pk);
        if (value !== undefined) {
          featureNameValueWithGrantedProvider.value = value;
          featureNameValueWithGrantedProvider.provider = new FeatureValueProviderInfo(provider.name, pk);
          break;
        }
      }

      if (featureNameValueWithGrantedProvider.value !== undefined) featureValues.set(feature.name, featureNameValueWithGrantedProvider);
    }

    return [...featureValues.values()];
  }

  async set(name: string, value: string | undefined, providerName: string, providerKey: string | undefined, forceToSet = false): Promise<void> {
    Check.notNull(name, "name");
    Check.notNull(providerName, "providerName");

    const feature = await this.featureDefinitionManager.get(name);
    if (!feature.valueType.validator.isValid(value)) throw new FeatureValueInvalidException(feature.displayName.localize(this.stringLocalizerFactory).value);
    if (feature.allowedProviders.length > 0 && !feature.allowedProviders.includes(providerName)) {
      throw new AbpException(`The feature named '${name}' is not compatible with the provider named '${providerName}'`);
    }

    let providers = skipWhile([...this.providers].reverse(), (p) => p.name !== providerName);
    if (providers.length === 0) throw new AbpException(`Unknown feature value provider: ${providerName}`);

    if (providers.length > 1 && !forceToSet && value !== undefined) {
      await using _context = await providers[0]!.handleContext(providerName, providerKey);
      const fallbackValue = await this.getOrNullInternal(name, providers[1]!.name, undefined);
      if (fallbackValue.value !== undefined && fallbackValue.value.toLowerCase() === value.toLowerCase()) value = undefined;
    }

    providers = takeWhile(providers, (p) => p.name === providerName);

    if (value === undefined) {
      for (const provider of providers) await provider.clear(feature, providerKey);
    } else {
      for (const provider of providers) await provider.set(feature, value, providerKey);
    }
  }

  protected async getOrNullInternal(name: string, providerName: string | undefined, providerKey: string | undefined, _fallback = true): Promise<FeatureNameValueWithGrantedProvider> {
    const feature = await this.featureDefinitionManager.get(name);
    let providers: IFeatureManagementProvider[] = [...this.providers].reverse();
    if (providerName !== undefined) providers = skipWhile(providers, (p) => p.name !== providerName);
    if (feature.allowedProviders.length > 0) providers = providers.filter((p) => feature.allowedProviders.includes(p.name));

    const featureNameValueWithGrantedProvider = new FeatureNameValueWithGrantedProvider(name, undefined);
    for (const provider of providers) {
      const pk = providerName !== undefined && provider.compatible(providerName) ? providerKey : undefined;
      const value = await provider.getOrNull(feature, pk);
      if (value !== undefined) {
        featureNameValueWithGrantedProvider.value = value;
        featureNameValueWithGrantedProvider.provider = new FeatureValueProviderInfo(provider.name, pk);
        break;
      }
    }
    return featureNameValueWithGrantedProvider;
  }

  async delete(providerName: string, providerKey: string | undefined): Promise<void> {
    const featureNameValues = await this.getAll(providerName, providerKey);

    let providers = skipWhile([...this.providers].reverse(), (p) => p.name !== providerName);
    if (providers.length === 0) return;
    providers = takeWhile(providers, (p) => p.name === providerName);

    for (const featureNameValue of featureNameValues) {
      const feature = await this.featureDefinitionManager.get(featureNameValue.name);
      for (const provider of providers) await provider.clear(feature, providerKey);
    }
  }
}

/** Port of the `*FeatureManagerExtensions` classes (`GetOrNullForTenantAsync`, `SetForEditionAsync`, ...) as plain functions taking the manager first. */
export const FeatureManagerExtensions = {
  getOrNullDefault(featureManager: IFeatureManager, name: string, fallback = true): Promise<string | undefined> {
    return featureManager.getOrNull(name, DefaultValueFeatureValueProvider.ProviderName, undefined, fallback);
  },
  getAllDefault(featureManager: IFeatureManager, fallback = true): Promise<FeatureNameValue[]> {
    return featureManager.getAll(DefaultValueFeatureValueProvider.ProviderName, undefined, fallback);
  },
  getOrNullWithProviderDefault(featureManager: IFeatureManager, name: string, fallback = true): Promise<FeatureNameValueWithGrantedProvider> {
    return featureManager.getOrNullWithProvider(name, DefaultValueFeatureValueProvider.ProviderName, undefined, fallback);
  },
  getAllWithProviderDefault(featureManager: IFeatureManager, fallback = true): Promise<FeatureNameValueWithGrantedProvider[]> {
    return featureManager.getAllWithProvider(DefaultValueFeatureValueProvider.ProviderName, undefined, fallback);
  },
  getOrNullConfiguration(featureManager: IFeatureManager, name: string, fallback = true): Promise<string | undefined> {
    return featureManager.getOrNull(name, ConfigurationFeatureValueProvider.ProviderName, undefined, fallback);
  },
  getAllConfiguration(featureManager: IFeatureManager, fallback = true): Promise<FeatureNameValue[]> {
    return featureManager.getAll(ConfigurationFeatureValueProvider.ProviderName, undefined, fallback);
  },
  getOrNullForEdition(featureManager: IFeatureManager, name: string, editionId: Guid, fallback = true): Promise<string | undefined> {
    return featureManager.getOrNull(name, EditionFeatureValueProvider.ProviderName, editionId, fallback);
  },
  getAllForEdition(featureManager: IFeatureManager, editionId: Guid, fallback = true): Promise<FeatureNameValue[]> {
    return featureManager.getAll(EditionFeatureValueProvider.ProviderName, editionId, fallback);
  },
  getOrNullWithProviderForEdition(featureManager: IFeatureManager, name: string, editionId: Guid, fallback = true): Promise<FeatureNameValueWithGrantedProvider> {
    return featureManager.getOrNullWithProvider(name, EditionFeatureValueProvider.ProviderName, editionId, fallback);
  },
  getAllWithProviderForEdition(featureManager: IFeatureManager, editionId: Guid, fallback = true): Promise<FeatureNameValueWithGrantedProvider[]> {
    return featureManager.getAllWithProvider(EditionFeatureValueProvider.ProviderName, editionId, fallback);
  },
  setForEdition(featureManager: IFeatureManager, editionId: Guid, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    return featureManager.set(name, value, EditionFeatureValueProvider.ProviderName, editionId, forceToSet);
  },
  getOrNullForTenant(featureManager: IFeatureManager, name: string, tenantId: Guid, fallback = true): Promise<string | undefined> {
    return featureManager.getOrNull(name, TenantFeatureValueProvider.ProviderName, tenantId, fallback);
  },
  getAllForTenant(featureManager: IFeatureManager, tenantId: Guid, fallback = true): Promise<FeatureNameValue[]> {
    return featureManager.getAll(TenantFeatureValueProvider.ProviderName, tenantId, fallback);
  },
  getOrNullWithProviderForTenant(featureManager: IFeatureManager, name: string, tenantId: Guid, fallback = true): Promise<FeatureNameValueWithGrantedProvider> {
    return featureManager.getOrNullWithProvider(name, TenantFeatureValueProvider.ProviderName, tenantId, fallback);
  },
  getAllWithProviderForTenant(featureManager: IFeatureManager, tenantId: Guid, fallback = true): Promise<FeatureNameValueWithGrantedProvider[]> {
    return featureManager.getAllWithProvider(TenantFeatureValueProvider.ProviderName, tenantId, fallback);
  },
  setForTenant(featureManager: IFeatureManager, tenantId: Guid, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    return featureManager.set(name, value, TenantFeatureValueProvider.ProviderName, tenantId, forceToSet);
  },
};
