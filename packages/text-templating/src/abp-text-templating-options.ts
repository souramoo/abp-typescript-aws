import { TypeList, type Class } from "@abp/core";
import type { ITemplateContentContributor } from "./template-content-contributor.js";
import type { ITemplateDefinitionProvider } from "./template-definition-provider.js";
import type { ITemplateRenderingEngine } from "./template-rendering-engine.js";

/** Culture key used for content that is not bound to a culture (a single-file template in .NET). */
const CultureIndependent = "";

/** In-memory template contents keyed by template name and culture (replaces the embedded virtual files). */
export class TemplateContentDictionary {
  private readonly contents = new Map<string, Map<string, string>>();

  /** Registers `text` for `name`; `culture` undefined means culture-independent content. */
  add(name: string, culture: string | undefined, text: string): this {
    let byCulture = this.contents.get(name);
    if (!byCulture) {
      byCulture = new Map();
      this.contents.set(name, byCulture);
    }
    byCulture.set(culture ?? CultureIndependent, text);
    return this;
  }

  getOrNull(name: string, culture: string | undefined): string | undefined {
    return this.contents.get(name)?.get(culture ?? CultureIndependent);
  }

  has(name: string): boolean {
    return this.contents.has(name);
  }
}

/** Port of `AbpTextTemplatingOptions` (+ the in-memory and file contributor settings of this port). */
export class AbpTextTemplatingOptions {
  readonly definitionProviders = new TypeList<ITemplateDefinitionProvider>();
  readonly contentContributors = new TypeList<ITemplateContentContributor>();
  readonly renderingEngines = new Map<string, Class<ITemplateRenderingEngine>>();
  defaultRenderingEngine: string | undefined;
  readonly deletedTemplates = new Set<string>();
  /** Template texts served by `InMemoryTemplateContentContributor`. */
  readonly contents = new TemplateContentDictionary();
  /** Root directory of `FileTemplateContentContributor` for definitions without an explicit file path: `{root}/{name}/{culture}.tpl` or `{root}/{name}.tpl`. */
  fileTemplateRootPath: string | undefined;
  /** File extensions (in order) the file contributor accepts. Default: `.tpl`, `.cshtml`. */
  readonly fileTemplateExtensions: string[] = [".tpl", ".cshtml"];
}
