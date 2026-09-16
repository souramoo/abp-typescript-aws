import { AbpException, IServiceProviderToken, Transient, createToken, isNullOrWhiteSpace, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpTextTemplatingOptions } from "./abp-text-templating-options.js";
import { ITemplateDefinitionManager } from "./template-definition-store.js";
import type { TemplateGlobalContext } from "./template-rendering-engine.js";

/** Port of `ITemplateRenderer`. */
export interface ITemplateRenderer {
  /**
   * Renders a text template.
   * @param templateName The template name
   * @param model An optional model object that is used in the template
   * @param cultureName Culture name. Uses the current UI culture if not specified
   * @param globalContext Objects imported into the template as top-level names
   */
  render(templateName: string, model?: unknown, cultureName?: string, globalContext?: TemplateGlobalContext): Promise<string>;
}
export const ITemplateRenderer = createToken<ITemplateRenderer>("ITemplateRenderer");

/** Port of `AbpTemplateRenderer`: picks the rendering engine of the definition (or the default one) and delegates. */
@Transient(ITemplateRenderer)
export class AbpTemplateRenderer implements ITemplateRenderer {
  static readonly inject = [IServiceProviderToken, ITemplateDefinitionManager, optionsToken(AbpTextTemplatingOptions)] as const;
  protected readonly options: AbpTextTemplatingOptions;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    protected readonly templateDefinitionManager: ITemplateDefinitionManager,
    options: IOptions<AbpTextTemplatingOptions>,
  ) {
    this.options = options.value;
  }

  async render(templateName: string, model?: unknown, cultureName?: string, globalContext?: TemplateGlobalContext): Promise<string> {
    const templateDefinition = await this.templateDefinitionManager.get(templateName);
    const renderEngine = isNullOrWhiteSpace(templateDefinition.renderEngine) ? this.options.defaultRenderingEngine : templateDefinition.renderEngine;
    const engineType = renderEngine === undefined ? undefined : this.options.renderingEngines.get(renderEngine);
    if (!engineType) throw new AbpException(`There is no rendering engine found with template name: ${templateName}`);

    await using scope = this.serviceProvider.createScope();
    const engine = scope.serviceProvider.getRequired(engineType);
    return engine.render(templateName, model, cultureName, globalContext);
  }
}

/** Port of `TemplateRenderingContext`-style helper: the arguments of one rendering, passed between engine methods. */
export class TemplateRenderingContext {
  constructor(
    readonly templateName: string,
    readonly model: unknown,
    readonly cultureName: string | undefined,
    readonly globalContext: TemplateGlobalContext,
  ) {}
}
