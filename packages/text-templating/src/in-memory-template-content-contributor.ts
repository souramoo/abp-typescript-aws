import { Transient, optionsToken, type IOptions } from "@abp/core";
import { AbpTextTemplatingOptions } from "./abp-text-templating-options.js";
import { ITemplateContentContributor, type TemplateContentContributorContext } from "./template-content-contributor.js";

/** Serves the texts registered with `AbpTextTemplatingOptions.contents.add(name, culture, text)`. */
@Transient()
@ITemplateContentContributor()
export class InMemoryTemplateContentContributor implements ITemplateContentContributor {
  static readonly inject = [optionsToken(AbpTextTemplatingOptions)] as const;
  protected readonly options: AbpTextTemplatingOptions;

  constructor(options: IOptions<AbpTextTemplatingOptions>) {
    this.options = options.value;
  }

  async getOrNull(context: TemplateContentContributorContext): Promise<string | undefined> {
    return this.options.contents.getOrNull(context.templateDefinition.name, context.culture);
  }
}
