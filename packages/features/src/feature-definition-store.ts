import { AbpException, Check, IServiceProviderToken, Singleton, createToken, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpFeatureOptions } from "./abp-feature-options.js";
import { FeatureDefinitionContext, type FeatureDefinition, type FeatureGroupDefinition } from "./feature-definition.js";

/** Port of `IStaticFeatureDefinitionStore`. */
export interface IStaticFeatureDefinitionStore {
  getOrNull(name: string): Promise<FeatureDefinition | undefined>;
  getFeatures(): Promise<readonly FeatureDefinition[]>;
  getGroups(): Promise<readonly FeatureGroupDefinition[]>;
}
export const IStaticFeatureDefinitionStore = createToken<IStaticFeatureDefinitionStore>("IStaticFeatureDefinitionStore");

/** Port of `IDynamicFeatureDefinitionStore`. */
export type IDynamicFeatureDefinitionStore = IStaticFeatureDefinitionStore;
export const IDynamicFeatureDefinitionStore = createToken<IDynamicFeatureDefinitionStore>("IDynamicFeatureDefinitionStore");

/**
 * Port of `StaticFeatureDefinitionStore`. `IStaticDefinitionCache` does not exist in this port; definitions are
 * built once per store instance (singleton) from `AbpFeatureOptions.definitionProviders` on first use.
 */
@Singleton(IStaticFeatureDefinitionStore)
export class StaticFeatureDefinitionStore implements IStaticFeatureDefinitionStore {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpFeatureOptions)] as const;
  protected readonly options: AbpFeatureOptions;
  private groupDefinitions: Promise<Map<string, FeatureGroupDefinition>> | undefined;
  private featureDefinitions: Promise<Map<string, FeatureDefinition>> | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpFeatureOptions>,
  ) {
    this.options = options.value;
  }

  async get(name: string): Promise<FeatureDefinition> {
    const feature = await this.getOrNull(Check.notNull(name, "name"));
    if (!feature) throw new AbpException(`Undefined feature: ${name}`);
    return feature;
  }

  async getOrNull(name: string): Promise<FeatureDefinition | undefined> {
    return (await this.getFeatureDefinitions()).get(name);
  }

  async getFeatures(): Promise<readonly FeatureDefinition[]> {
    return [...(await this.getFeatureDefinitions()).values()];
  }

  async getGroups(): Promise<readonly FeatureGroupDefinition[]> {
    return [...(await this.getFeatureGroupDefinitions()).values()];
  }

  protected getFeatureGroupDefinitions(): Promise<Map<string, FeatureGroupDefinition>> {
    this.groupDefinitions ??= this.createFeatureGroupDefinitions();
    return this.groupDefinitions;
  }

  protected getFeatureDefinitions(): Promise<Map<string, FeatureDefinition>> {
    this.featureDefinitions ??= this.createFeatureDefinitions();
    return this.featureDefinitions;
  }

  protected async createFeatureGroupDefinitions(): Promise<Map<string, FeatureGroupDefinition>> {
    const context = new FeatureDefinitionContext();
    await using scope = this.serviceProvider.createScope();
    for (const type of this.options.definitionProviders) scope.serviceProvider.getRequired(type).define(context);
    return context.groups;
  }

  protected async createFeatureDefinitions(): Promise<Map<string, FeatureDefinition>> {
    const features = new Map<string, FeatureDefinition>();
    for (const group of (await this.getFeatureGroupDefinitions()).values()) {
      for (const feature of group.features) addFeatureRecursively(features, feature);
    }
    return features;
  }
}

function addFeatureRecursively(features: Map<string, FeatureDefinition>, feature: FeatureDefinition): void {
  if (features.has(feature.name)) throw new AbpException(`Duplicate feature name: ${feature.name}`);
  features.set(feature.name, feature);
  for (const child of feature.children) addFeatureRecursively(features, child);
}

/** Port of `NullDynamicFeatureDefinitionStore`. */
@Singleton(IDynamicFeatureDefinitionStore)
export class NullDynamicFeatureDefinitionStore implements IDynamicFeatureDefinitionStore {
  async getOrNull(): Promise<FeatureDefinition | undefined> {
    return undefined;
  }
  async getFeatures(): Promise<readonly FeatureDefinition[]> {
    return [];
  }
  async getGroups(): Promise<readonly FeatureGroupDefinition[]> {
    return [];
  }
}

/** Port of `IFeatureDefinitionManager`. */
export interface IFeatureDefinitionManager {
  get(name: string): Promise<FeatureDefinition>;
  getAll(): Promise<readonly FeatureDefinition[]>;
  getOrNull(name: string): Promise<FeatureDefinition | undefined>;
  getGroups(): Promise<readonly FeatureGroupDefinition[]>;
}
export const IFeatureDefinitionManager = createToken<IFeatureDefinitionManager>("IFeatureDefinitionManager");

/** Port of `FeatureDefinitionManager`: static definitions win over dynamic ones. */
@Singleton(IFeatureDefinitionManager)
export class FeatureDefinitionManager implements IFeatureDefinitionManager {
  static readonly inject = [IStaticFeatureDefinitionStore, IDynamicFeatureDefinitionStore] as const;

  constructor(
    protected readonly staticStore: IStaticFeatureDefinitionStore,
    protected readonly dynamicStore: IDynamicFeatureDefinitionStore,
  ) {}

  async get(name: string): Promise<FeatureDefinition> {
    const feature = await this.getOrNull(name);
    if (!feature) throw new AbpException(`Undefined feature: ${name}`);
    return feature;
  }

  async getOrNull(name: string): Promise<FeatureDefinition | undefined> {
    Check.notNull(name, "name");
    return (await this.staticStore.getOrNull(name)) ?? (await this.dynamicStore.getOrNull(name));
  }

  async getAll(): Promise<readonly FeatureDefinition[]> {
    const staticFeatures = await this.staticStore.getFeatures();
    const staticNames = new Set(staticFeatures.map((f) => f.name));
    const dynamicFeatures = await this.dynamicStore.getFeatures();
    return [...staticFeatures, ...dynamicFeatures.filter((d) => !staticNames.has(d.name))];
  }

  async getGroups(): Promise<readonly FeatureGroupDefinition[]> {
    const staticGroups = await this.staticStore.getGroups();
    const staticNames = new Set(staticGroups.map((g) => g.name));
    const dynamicGroups = await this.dynamicStore.getGroups();
    return [...staticGroups, ...dynamicGroups.filter((d) => !staticNames.has(d.name))];
  }
}
