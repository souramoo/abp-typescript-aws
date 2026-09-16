import { AbpException, Check, CultureHelper, IServiceProviderToken, Transient, createToken, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpTextTemplatingOptions } from "./abp-text-templating-options.js";
import { TemplateContentContributorContext, type ITemplateContentContributor } from "./template-content-contributor.js";
import type { TemplateDefinition } from "./template-definition.js";
import { ITemplateDefinitionManager } from "./template-definition-store.js";

/** Port of `ITemplateContentProvider`. */
export interface ITemplateContentProvider {
  getContentOrNull(templateNameOrDefinition: string | TemplateDefinition, cultureName?: string, tryDefaults?: boolean, useCurrentCultureIfCultureNameIsNull?: boolean): Promise<string | undefined>;
}
export const ITemplateContentProvider = createToken<ITemplateContentProvider>("ITemplateContentProvider");

/** Port of `TemplateContentProvider`: requested culture → base culture → culture independent (inline localized) or default culture. */
@Transient(ITemplateContentProvider)
export class TemplateContentProvider implements ITemplateContentProvider {
  static readonly inject = [ITemplateDefinitionManager, IServiceProviderToken, optionsToken(AbpTextTemplatingOptions)] as const;
  readonly options: AbpTextTemplatingOptions;

  constructor(
    private readonly templateDefinitionManager: ITemplateDefinitionManager,
    readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpTextTemplatingOptions>,
  ) {
    this.options = options.value;
  }

  async getContentOrNull(templateNameOrDefinition: string | TemplateDefinition, cultureName?: string, tryDefaults = true, useCurrentCultureIfCultureNameIsNull = true): Promise<string | undefined> {
    const templateDefinition = typeof templateNameOrDefinition === "string" ? await this.templateDefinitionManager.get(templateNameOrDefinition) : Check.notNull(templateNameOrDefinition, "templateDefinition");

    if (this.options.contentContributors.length === 0) {
      throw new AbpException("No template content contributor was registered. Use AbpTextTemplatingOptions to register contributors!");
    }

    await using scope = this.serviceProvider.createScope();
    if (cultureName === undefined && useCurrentCultureIfCultureNameIsNull) cultureName = CultureHelper.currentUICulture;

    const contributors = this.createTemplateContentContributors(scope.serviceProvider);
    const tryCulture = (culture: string | undefined) => this.getContentFromContributors(contributors, new TemplateContentContributorContext(templateDefinition, scope.serviceProvider, culture));

    const requested = await tryCulture(cultureName);
    if (requested !== undefined) return requested;
    if (!tryDefaults) return undefined;

    if (cultureName !== undefined && cultureName.includes("-")) {
      const fromBase = await tryCulture(CultureHelper.getBaseCultureName(cultureName));
      if (fromBase !== undefined) return fromBase;
    }

    if (templateDefinition.isInlineLocalized) {
      const independent = await tryCulture(undefined);
      if (independent !== undefined) return independent;
    } else if (templateDefinition.defaultCultureName !== undefined) {
      const fromDefault = await tryCulture(templateDefinition.defaultCultureName);
      if (fromDefault !== undefined) return fromDefault;
    }

    return undefined;
  }

  /** Later registered contributors are consulted first, as in .NET. */
  protected createTemplateContentContributors(serviceProvider: IServiceProvider): ITemplateContentContributor[] {
    return this.options.contentContributors
      .toArray()
      .map((type) => serviceProvider.getRequired(type))
      .reverse();
  }

  protected async getContentFromContributors(contributors: readonly ITemplateContentContributor[], context: TemplateContentContributorContext): Promise<string | undefined> {
    for (const contributor of contributors) {
      const content = await contributor.getOrNull(context);
      if (content !== undefined) return content;
    }
    return undefined;
  }
}
