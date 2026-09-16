import { Check, FixedLocalizableString, type Class, type ILocalizableString } from "@abp/core";
import { getLocalizationResourceName, type IHasNameWithLocalizableDisplayName } from "@abp/localization";

/** Name of the `properties` entry holding a template's file path (port of `VirtualFileTemplateContentContributor.VirtualPathPropertyName`). */
export const TemplateFilePathPropertyName = "FilePath";

export interface TemplateDefinitionOptions {
  /** A localization resource class or its resource name; the template's `L` helper localizes with it. */
  localizationResource?: Class | string;
  displayName?: ILocalizableString;
  isLayout?: boolean;
  layout?: string;
  defaultCultureName?: string;
  /** True when the content is culture independent (localized inline with `L`); a settable property in .NET. */
  isInlineLocalized?: boolean;
}

/** Port of `TemplateDefinition`. The two .NET constructors collapse into one taking an options object. */
export class TemplateDefinition implements IHasNameWithLocalizableDisplayName {
  static readonly MaxNameLength = 128;

  readonly name: string;
  private displayNameValue!: ILocalizableString;
  readonly isLayout: boolean;
  layout: string | undefined;
  localizationResourceName: string | undefined;
  isInlineLocalized: boolean;
  readonly defaultCultureName: string | undefined;
  renderEngine: string | undefined;
  /** Can be used to get/set custom properties for this template. */
  readonly properties = new Map<string, unknown>();

  constructor(name: string, options: TemplateDefinitionOptions = {}) {
    this.name = Check.notNullOrWhiteSpace(name, "name", TemplateDefinition.MaxNameLength);
    this.localizationResourceName = typeof options.localizationResource === "string" ? options.localizationResource : options.localizationResource ? getLocalizationResourceName(options.localizationResource) : undefined;
    this.displayName = options.displayName ?? new FixedLocalizableString(this.name);
    this.isLayout = options.isLayout ?? false;
    this.layout = options.layout;
    this.defaultCultureName = options.defaultCultureName;
    this.isInlineLocalized = options.isInlineLocalized ?? false;
  }

  get displayName(): ILocalizableString {
    return this.displayNameValue;
  }
  set displayName(value: ILocalizableString) {
    this.displayNameValue = Check.notNull(value, "value");
  }

  /** `definition[name]` in .NET. */
  getProperty(name: string): unknown {
    return this.properties.get(name);
  }

  withProperty(key: string, value: unknown): this {
    this.properties.set(key, value);
    return this;
  }

  withRenderEngine(renderEngine: string): this {
    this.renderEngine = renderEngine;
    return this;
  }

  /**
   * Port of `WithVirtualFilePath`: the content lives at `path` on the real file system, either a single file
   * (culture independent) or a directory of `{culture}.tpl` files.
   */
  withFilePath(path: string, isInlineLocalized: boolean): this {
    Check.notNullOrWhiteSpace(path, "path");
    this.isInlineLocalized = isInlineLocalized;
    return this.withProperty(TemplateFilePathPropertyName, path);
  }

  /** Port of `GetVirtualFilePathOrNull`. */
  getFilePathOrNull(): string | undefined {
    const value = this.properties.get(TemplateFilePathPropertyName);
    return typeof value === "string" ? value : undefined;
  }
}
