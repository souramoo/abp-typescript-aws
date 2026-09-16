import { AbpException, Check, IServiceProviderToken, Singleton, createToken, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpTextTemplatingOptions } from "./abp-text-templating-options.js";
import type { TemplateDefinition } from "./template-definition.js";
import { TemplateDefinitionContext } from "./template-definition-provider.js";

/** Port of `IStaticTemplateDefinitionStore`. */
export interface IStaticTemplateDefinitionStore {
  get(name: string): Promise<TemplateDefinition>;
  getAll(): Promise<readonly TemplateDefinition[]>;
  getOrNull(name: string): Promise<TemplateDefinition | undefined>;
}
export const IStaticTemplateDefinitionStore = createToken<IStaticTemplateDefinitionStore>("IStaticTemplateDefinitionStore");

/** Port of `IDynamicTemplateDefinitionStore`. */
export type IDynamicTemplateDefinitionStore = IStaticTemplateDefinitionStore;
export const IDynamicTemplateDefinitionStore = createToken<IDynamicTemplateDefinitionStore>("IDynamicTemplateDefinitionStore");

/**
 * Port of `StaticTemplateDefinitionStore`. `IStaticDefinitionCache` does not exist in this port; definitions are
 * built once per store instance (singleton) from `AbpTextTemplatingOptions.definitionProviders` on first use.
 */
@Singleton(IStaticTemplateDefinitionStore)
export class StaticTemplateDefinitionStore implements IStaticTemplateDefinitionStore {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpTextTemplatingOptions)] as const;
  protected readonly options: AbpTextTemplatingOptions;
  private definitions: Promise<Map<string, TemplateDefinition>> | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpTextTemplatingOptions>,
  ) {
    this.options = options.value;
  }

  async get(name: string): Promise<TemplateDefinition> {
    const template = await this.getOrNull(Check.notNull(name, "name"));
    if (!template) throw new AbpException(`Undefined template: ${name}`);
    return template;
  }

  async getAll(): Promise<readonly TemplateDefinition[]> {
    return [...(await this.getTemplateDefinitions()).values()];
  }

  async getOrNull(name: string): Promise<TemplateDefinition | undefined> {
    return (await this.getTemplateDefinitions()).get(name);
  }

  protected getTemplateDefinitions(): Promise<Map<string, TemplateDefinition>> {
    this.definitions ??= this.createTemplateDefinitions();
    return this.definitions;
  }

  protected async createTemplateDefinitions(): Promise<Map<string, TemplateDefinition>> {
    const templates = new Map<string, TemplateDefinition>();
    await using scope = this.serviceProvider.createScope();
    const providers = this.options.definitionProviders.toArray().map((type) => scope.serviceProvider.getRequired(type));
    const context = new TemplateDefinitionContext(templates);
    for (const provider of providers) provider.preDefine(context);
    for (const provider of providers) provider.define(context);
    for (const provider of providers) provider.postDefine(context);
    return templates;
  }
}

/** Port of `NullIDynamicTemplateDefinitionStore`. */
@Singleton(IDynamicTemplateDefinitionStore)
export class NullDynamicTemplateDefinitionStore implements IDynamicTemplateDefinitionStore {
  async get(name: string): Promise<TemplateDefinition> {
    throw new AbpException(`Undefined template: ${name}`);
  }
  async getAll(): Promise<readonly TemplateDefinition[]> {
    return [];
  }
  async getOrNull(): Promise<TemplateDefinition | undefined> {
    return undefined;
  }
}

/** Port of `ITemplateDefinitionManager`. */
export interface ITemplateDefinitionManager {
  get(name: string): Promise<TemplateDefinition>;
  getAll(): Promise<readonly TemplateDefinition[]>;
  getOrNull(name: string): Promise<TemplateDefinition | undefined>;
}
export const ITemplateDefinitionManager = createToken<ITemplateDefinitionManager>("ITemplateDefinitionManager");

/** Port of `TemplateDefinitionManager`: static definitions win over dynamic ones. */
@Singleton(ITemplateDefinitionManager)
export class TemplateDefinitionManager implements ITemplateDefinitionManager {
  static readonly inject = [IStaticTemplateDefinitionStore, IDynamicTemplateDefinitionStore] as const;

  constructor(
    protected readonly staticStore: IStaticTemplateDefinitionStore,
    protected readonly dynamicStore: IDynamicTemplateDefinitionStore,
  ) {}

  async get(name: string): Promise<TemplateDefinition> {
    const template = await this.getOrNull(name);
    if (!template) throw new AbpException(`Undefined Template: ${name}`);
    return template;
  }

  async getOrNull(name: string): Promise<TemplateDefinition | undefined> {
    Check.notNull(name, "name");
    return (await this.staticStore.getOrNull(name)) ?? (await this.dynamicStore.getOrNull(name));
  }

  async getAll(): Promise<readonly TemplateDefinition[]> {
    const staticTemplates = await this.staticStore.getAll();
    const staticNames = new Set(staticTemplates.map((t) => t.name));
    const dynamicTemplates = await this.dynamicStore.getAll();
    return [...staticTemplates, ...dynamicTemplates.filter((d) => !staticNames.has(d.name))];
  }
}
