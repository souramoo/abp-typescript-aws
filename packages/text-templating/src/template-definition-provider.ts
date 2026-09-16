import { createClassMarker, type AbstractClass } from "@abp/core";
import type { TemplateDefinition } from "./template-definition.js";

/** Port of `ITemplateDefinitionContext`. */
export interface ITemplateDefinitionContext {
  getAll(): readonly TemplateDefinition[];
  getOrNull(name: string): TemplateDefinition | undefined;
  add(...definitions: TemplateDefinition[]): void;
}

/** Port of `TemplateDefinitionContext`. */
export class TemplateDefinitionContext implements ITemplateDefinitionContext {
  constructor(protected readonly templates: Map<string, TemplateDefinition>) {}

  getAll(): readonly TemplateDefinition[] {
    return [...this.templates.values()];
  }

  getOrNull(name: string): TemplateDefinition | undefined {
    return this.templates.get(name);
  }

  add(...definitions: TemplateDefinition[]): void {
    for (const definition of definitions) this.templates.set(definition.name, definition);
  }
}

/**
 * Port of `ITemplateDefinitionProvider`. Implementations are discovered by the class marker (subclasses of
 * `TemplateDefinitionProvider` carry it; other classes use `@ITemplateDefinitionProvider()`) and added to
 * `AbpTextTemplatingOptions.definitionProviders`.
 */
export interface ITemplateDefinitionProvider {
  preDefine(context: ITemplateDefinitionContext): void;
  define(context: ITemplateDefinitionContext): void;
  postDefine(context: ITemplateDefinitionContext): void;
}
export const ITemplateDefinitionProvider = createClassMarker("ITemplateDefinitionProvider");

/** Port of `TemplateDefinitionProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class TemplateDefinitionProvider implements ITemplateDefinitionProvider {
  preDefine(_context: ITemplateDefinitionContext): void {}
  abstract define(context: ITemplateDefinitionContext): void;
  postDefine(_context: ITemplateDefinitionContext): void {}
}
ITemplateDefinitionProvider.mark(TemplateDefinitionProvider as AbstractClass);
