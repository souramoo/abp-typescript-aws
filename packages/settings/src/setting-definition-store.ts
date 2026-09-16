import { AbpException, Check, IServiceProviderToken, Singleton, createToken, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpSettingOptions } from "./abp-setting-options.js";
import { SettingDefinitionContext, type SettingDefinition } from "./setting-definition.js";

/** Port of `IStaticSettingDefinitionStore`. */
export interface IStaticSettingDefinitionStore {
  get(name: string): Promise<SettingDefinition>;
  getAll(): Promise<readonly SettingDefinition[]>;
  getOrNull(name: string): Promise<SettingDefinition | undefined>;
}
export const IStaticSettingDefinitionStore = createToken<IStaticSettingDefinitionStore>("IStaticSettingDefinitionStore");

/** Port of `IDynamicSettingDefinitionStore`. */
export type IDynamicSettingDefinitionStore = IStaticSettingDefinitionStore;
export const IDynamicSettingDefinitionStore = createToken<IDynamicSettingDefinitionStore>("IDynamicSettingDefinitionStore");

/**
 * Port of `StaticSettingDefinitionStore`. `IStaticDefinitionCache` does not exist in this port; definitions are
 * built once per store instance (singleton) from `AbpSettingOptions.definitionProviders` on first use.
 */
@Singleton(IStaticSettingDefinitionStore)
export class StaticSettingDefinitionStore implements IStaticSettingDefinitionStore {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpSettingOptions)] as const;
  protected readonly options: AbpSettingOptions;
  private definitions: Promise<Map<string, SettingDefinition>> | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpSettingOptions>,
  ) {
    this.options = options.value;
  }

  async get(name: string): Promise<SettingDefinition> {
    const setting = await this.getOrNull(Check.notNull(name, "name"));
    if (!setting) throw new AbpException(`Undefined setting: ${name}`);
    return setting;
  }

  async getAll(): Promise<readonly SettingDefinition[]> {
    return [...(await this.getSettingDefinitions()).values()];
  }

  async getOrNull(name: string): Promise<SettingDefinition | undefined> {
    return (await this.getSettingDefinitions()).get(name);
  }

  protected getSettingDefinitions(): Promise<Map<string, SettingDefinition>> {
    this.definitions ??= this.createSettingDefinitions();
    return this.definitions;
  }

  protected async createSettingDefinitions(): Promise<Map<string, SettingDefinition>> {
    const settings = new Map<string, SettingDefinition>();
    await using scope = this.serviceProvider.createScope();
    for (const type of this.options.definitionProviders) {
      scope.serviceProvider.getRequired(type).define(new SettingDefinitionContext(settings));
    }
    return settings;
  }
}

/** Port of `NullDynamicSettingDefinitionStore`. */
@Singleton(IDynamicSettingDefinitionStore)
export class NullDynamicSettingDefinitionStore implements IDynamicSettingDefinitionStore {
  async get(name: string): Promise<SettingDefinition> {
    throw new AbpException(`Undefined setting: ${name}`);
  }
  async getAll(): Promise<readonly SettingDefinition[]> {
    return [];
  }
  async getOrNull(): Promise<SettingDefinition | undefined> {
    return undefined;
  }
}

/** Port of `ISettingDefinitionManager`. */
export interface ISettingDefinitionManager {
  get(name: string): Promise<SettingDefinition>;
  getAll(): Promise<readonly SettingDefinition[]>;
  getOrNull(name: string): Promise<SettingDefinition | undefined>;
}
export const ISettingDefinitionManager = createToken<ISettingDefinitionManager>("ISettingDefinitionManager");

/** Port of `SettingDefinitionManager`: static definitions win over dynamic ones. */
@Singleton(ISettingDefinitionManager)
export class SettingDefinitionManager implements ISettingDefinitionManager {
  static readonly inject = [IStaticSettingDefinitionStore, IDynamicSettingDefinitionStore] as const;

  constructor(
    protected readonly staticStore: IStaticSettingDefinitionStore,
    protected readonly dynamicStore: IDynamicSettingDefinitionStore,
  ) {}

  async get(name: string): Promise<SettingDefinition> {
    const setting = await this.getOrNull(name);
    if (!setting) throw new AbpException(`Undefined setting: ${name}`);
    return setting;
  }

  async getOrNull(name: string): Promise<SettingDefinition | undefined> {
    Check.notNull(name, "name");
    return (await this.staticStore.getOrNull(name)) ?? (await this.dynamicStore.getOrNull(name));
  }

  async getAll(): Promise<readonly SettingDefinition[]> {
    const staticSettings = await this.staticStore.getAll();
    const staticNames = new Set(staticSettings.map((s) => s.name));
    const dynamicSettings = await this.dynamicStore.getAll();
    return [...staticSettings, ...dynamicSettings.filter((d) => !staticNames.has(d.name))];
  }
}
