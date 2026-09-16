import { AbpException, IConfiguration, IServiceProviderToken, Singleton, Transient, createToken, optionsToken, type Guid, type IOptions, type IServiceProvider, type ServiceKey } from "@abp/core";
import { ICurrentTenant, ITenantStore } from "@abp/multi-tenancy-abstractions";
import { ICurrentPrincipalAccessor, findEditionId } from "@abp/security";
import { AbpFeatureOptions } from "./abp-feature-options.js";
import type { FeatureDefinition } from "./feature-definition.js";
import { IFeatureStore } from "./feature-store.js";

/** Port of `IFeatureValueProvider`. */
export interface IFeatureValueProvider {
  readonly name: string;
  getOrNull(feature: FeatureDefinition): Promise<string | undefined>;
}
export const IFeatureValueProvider = createToken<IFeatureValueProvider>("IFeatureValueProvider");

/** Port of `FeatureValueProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class FeatureValueProvider implements IFeatureValueProvider {
  static readonly inject: readonly ServiceKey[] = [IFeatureStore];
  abstract readonly name: string;

  constructor(protected readonly featureStore: IFeatureStore) {}

  abstract getOrNull(feature: FeatureDefinition): Promise<string | undefined>;
}

/** Port of `DefaultValueFeatureValueProvider` ("D"). */
@Transient()
export class DefaultValueFeatureValueProvider extends FeatureValueProvider {
  static readonly ProviderName = "D";
  readonly name = DefaultValueFeatureValueProvider.ProviderName;

  async getOrNull(feature: FeatureDefinition): Promise<string | undefined> {
    return feature.defaultValue;
  }
}

/** Port of `ConfigurationFeatureValueProvider` ("C"): reads `Features:<name>` from `IConfiguration`. */
@Transient()
export class ConfigurationFeatureValueProvider extends FeatureValueProvider {
  static override readonly inject = [IFeatureStore, IConfiguration] as const;
  static readonly ConfigurationNamePrefix = "Features:";
  static readonly ProviderName = "C";
  readonly name = ConfigurationFeatureValueProvider.ProviderName;

  constructor(
    featureStore: IFeatureStore,
    protected readonly configuration: IConfiguration,
  ) {
    super(featureStore);
  }

  async getOrNull(feature: FeatureDefinition): Promise<string | undefined> {
    return this.configuration.get(ConfigurationFeatureValueProvider.ConfigurationNamePrefix + feature.name);
  }
}

/** Port of `EditionFeatureValueProvider` ("E"): the edition comes from the principal's claim or the current tenant. */
@Transient()
export class EditionFeatureValueProvider extends FeatureValueProvider {
  static override readonly inject = [IFeatureStore, ICurrentPrincipalAccessor, ITenantStore, ICurrentTenant] as const;
  static readonly ProviderName = "E";
  readonly name = EditionFeatureValueProvider.ProviderName;

  constructor(
    featureStore: IFeatureStore,
    protected readonly principalAccessor: ICurrentPrincipalAccessor,
    protected readonly tenantStore: ITenantStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(featureStore);
  }

  async getOrNull(feature: FeatureDefinition): Promise<string | undefined> {
    const editionId = await this.findEditionId();
    if (editionId === undefined) return undefined;
    return this.featureStore.getOrNull(feature.name, this.name, editionId);
  }

  protected async findEditionId(): Promise<Guid | undefined> {
    const editionId = findEditionId(this.principalAccessor.principal);
    if (editionId !== undefined) return editionId;
    if (this.currentTenant.id === undefined) return undefined;
    return (await this.tenantStore.findById(this.currentTenant.id))?.editionId;
  }
}

/** Port of `TenantFeatureValueProvider` ("T"). */
@Transient()
export class TenantFeatureValueProvider extends FeatureValueProvider {
  static override readonly inject = [IFeatureStore, ICurrentTenant] as const;
  static readonly ProviderName = "T";
  readonly name = TenantFeatureValueProvider.ProviderName;

  constructor(
    featureStore: IFeatureStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(featureStore);
  }

  getOrNull(feature: FeatureDefinition): Promise<string | undefined> {
    return this.featureStore.getOrNull(feature.name, this.name, this.currentTenant.id);
  }
}

/** Port of `IFeatureValueProviderManager`. */
export interface IFeatureValueProviderManager {
  readonly valueProviders: readonly IFeatureValueProvider[];
}
export const IFeatureValueProviderManager = createToken<IFeatureValueProviderManager>("IFeatureValueProviderManager");

/** Port of `FeatureValueProviderManager`: resolves `AbpFeatureOptions.valueProviders` lazily, once. */
@Singleton(IFeatureValueProviderManager)
export class FeatureValueProviderManager implements IFeatureValueProviderManager {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpFeatureOptions)] as const;
  protected readonly options: AbpFeatureOptions;
  private providers: IFeatureValueProvider[] | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpFeatureOptions>,
  ) {
    this.options = options.value;
  }

  get valueProviders(): readonly IFeatureValueProvider[] {
    this.providers ??= this.getProviders();
    return this.providers;
  }

  protected getProviders(): IFeatureValueProvider[] {
    const providers = this.options.valueProviders.toArray().map((type) => this.serviceProvider.getRequired(type));
    const byName = new Map<string, string[]>();
    for (const p of providers) byName.set(p.name, [...(byName.get(p.name) ?? []), p.constructor.name]);
    for (const [name, types] of byName) {
      if (types.length > 1) throw new AbpException(`Duplicate feature value provider name detected: ${name}. Providers:\n${types.join("\n")}`);
    }
    return providers;
  }
}
