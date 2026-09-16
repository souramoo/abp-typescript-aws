import { CultureHelper, IStringLocalizerFactory, isNullOrWhiteSpace, type IStringLocalizer, type ServiceKey } from "@abp/core";
import { isAbpStringLocalizerFactory } from "@abp/localization";
import { ITemplateContentProvider } from "./template-content-provider.js";
import type { TemplateDefinition } from "./template-definition.js";
import { ITemplateDefinitionManager } from "./template-definition-store.js";

/** Objects the template can read besides the model (port of the `Dictionary<string, object>` global context). */
export type TemplateGlobalContext = Record<string, unknown>;

/** Port of `ITemplateRenderingEngine`. Engines are classes registered in `AbpTextTemplatingOptions.renderingEngines`. */
export interface ITemplateRenderingEngine {
  readonly name: string;
  /** True when the engine restricts templates to a DSL without direct code execution. */
  readonly isSandboxed: boolean;
  render(templateName: string, model?: unknown, cultureName?: string, globalContext?: TemplateGlobalContext): Promise<string>;
}

/** Port of `TemplateRenderingEngineBase`. */
export abstract class TemplateRenderingEngineBase implements ITemplateRenderingEngine {
  static readonly CultureContextKey = "abp_culture";
  static readonly TextDirectionContextKey = "abp_dir";
  static readonly inject: readonly ServiceKey[] = [ITemplateDefinitionManager, ITemplateContentProvider, IStringLocalizerFactory];

  abstract readonly name: string;
  readonly isSandboxed: boolean = false;

  constructor(
    protected readonly templateDefinitionManager: ITemplateDefinitionManager,
    protected readonly templateContentProvider: ITemplateContentProvider,
    protected readonly stringLocalizerFactory: IStringLocalizerFactory,
  ) {}

  abstract render(templateName: string, model?: unknown, cultureName?: string, globalContext?: TemplateGlobalContext): Promise<string>;

  /** Must be called inside the culture scope of the rendering. Values set by the caller are kept. */
  protected setCultureContext(globalContext: TemplateGlobalContext): void {
    const cultureName = CultureHelper.currentUICulture;
    this.setCultureContextValue(globalContext, TemplateRenderingEngineBase.CultureContextKey, isNullOrWhiteSpace(cultureName) ? "en" : cultureName);
    this.setCultureContextValue(globalContext, TemplateRenderingEngineBase.TextDirectionContextKey, CultureHelper.isRtl() ? "rtl" : "ltr");
  }

  protected setCultureContextValue(globalContext: TemplateGlobalContext, key: string, value: string): void {
    if (!(key in globalContext)) globalContext[key] = value;
  }

  protected getContentOrNull(templateDefinition: TemplateDefinition): Promise<string | undefined> {
    return this.templateContentProvider.getContentOrNull(templateDefinition);
  }

  protected getLocalizerOrNull(templateDefinition: TemplateDefinition): IStringLocalizer | undefined {
    if (templateDefinition.localizationResourceName !== undefined) {
      if (isAbpStringLocalizerFactory(this.stringLocalizerFactory)) return this.stringLocalizerFactory.createByResourceNameOrNull(templateDefinition.localizationResourceName);
      return this.stringLocalizerFactory.createByResourceName(templateDefinition.localizationResourceName);
    }
    return this.stringLocalizerFactory.createDefaultOrNull();
  }
}
