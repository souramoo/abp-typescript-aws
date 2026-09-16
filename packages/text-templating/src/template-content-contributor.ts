import { Check, createClassMarker, type IServiceProvider } from "@abp/core";
import type { TemplateDefinition } from "./template-definition.js";

/** Port of `TemplateContentContributorContext`. */
export class TemplateContentContributorContext {
  readonly templateDefinition: TemplateDefinition;
  readonly serviceProvider: IServiceProvider;

  constructor(
    templateDefinition: TemplateDefinition,
    serviceProvider: IServiceProvider,
    readonly culture: string | undefined,
  ) {
    this.templateDefinition = Check.notNull(templateDefinition, "templateDefinition");
    this.serviceProvider = Check.notNull(serviceProvider, "serviceProvider");
  }
}

/**
 * Port of `ITemplateContentContributor`. Implementations are discovered by the class marker
 * (`@ITemplateContentContributor()`) and added to `AbpTextTemplatingOptions.contentContributors`.
 */
export interface ITemplateContentContributor {
  getOrNull(context: TemplateContentContributorContext): Promise<string | undefined>;
}
export const ITemplateContentContributor = createClassMarker("ITemplateContentContributor");
