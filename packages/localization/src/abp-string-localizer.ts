import { CultureHelper, formatIndexed, type IStringLocalizer, type LocalizedString } from "@abp/core";
import type { AbpLocalizationOptions } from "./abp-localization-options.js";
import type { LocalizationResourceBase } from "./localization-resource.js";
import { createLocalizedString, notFoundString } from "./localized-string.js";

/** Port of `IAbpStringLocalizer`: the core `IStringLocalizer` plus ABP's extended enumeration methods. */
export interface IAbpStringLocalizer extends IStringLocalizer {
  withCulture(culture: string): IAbpStringLocalizer;
  getAllStrings(includeParentCultures?: boolean, includeBaseLocalizers?: boolean, includeDynamicContributors?: boolean): LocalizedString[];
  getAllStringsAsync(includeParentCultures?: boolean, includeBaseLocalizers?: boolean, includeDynamicContributors?: boolean): Promise<LocalizedString[]>;
  getSupportedCulturesAsync(): Promise<string[]>;
}

export function isAbpStringLocalizer(localizer: IStringLocalizer): localizer is IAbpStringLocalizer {
  return typeof (localizer as IAbpStringLocalizer).getSupportedCulturesAsync === "function";
}

/**
 * Port of `AbpDictionaryBasedStringLocalizer`. `localizer[name]` becomes `get(name)`, `localizer[name, args]`
 * becomes `get(name, ...args)` (`{0}`-style formatting) and `t(name, ...args)` returns the plain string.
 */
export class AbpDictionaryBasedStringLocalizer implements IAbpStringLocalizer {
  constructor(
    readonly resource: LocalizationResourceBase,
    readonly baseLocalizers: readonly IStringLocalizer[],
    readonly abpLocalizationOptions: AbpLocalizationOptions,
  ) {}

  get(name: string, ...args: unknown[]): LocalizedString {
    return args.length > 0 ? this.getLocalizedStringFormatted(name, CultureHelper.currentUICulture, args) : this.getLocalizedString(name, CultureHelper.currentUICulture);
  }

  t(name: string, ...args: unknown[]): string {
    return this.get(name, ...args).value;
  }

  withCulture(culture: string): IAbpStringLocalizer {
    return new CultureWrapperStringLocalizer(culture, this);
  }

  getAllStrings(includeParentCultures = true, includeBaseLocalizers = true, includeDynamicContributors = true): LocalizedString[] {
    return this.getAllStringsForCulture(CultureHelper.currentUICulture, includeParentCultures, includeBaseLocalizers, includeDynamicContributors);
  }

  async getAllStringsAsync(includeParentCultures = true, includeBaseLocalizers = true, includeDynamicContributors = true): Promise<LocalizedString[]> {
    return this.getAllStringsForCultureAsync(CultureHelper.currentUICulture, includeParentCultures, includeBaseLocalizers, includeDynamicContributors);
  }

  getSupportedCulturesAsync(): Promise<string[]> {
    return this.resource.contributors.getSupportedCulturesAsync();
  }

  getLocalizedStringFormatted(name: string, cultureName: string, args: unknown[]): LocalizedString {
    const localized = this.getLocalizedString(name, cultureName);
    return createLocalizedString(name, formatIndexed(localized.value, ...args), localized.resourceNotFound);
  }

  getLocalizedString(name: string, cultureName: string): LocalizedString {
    const value = this.getLocalizedStringOrNull(name, cultureName);
    if (value) return value;
    for (const baseLocalizer of this.baseLocalizers) {
      const baseLocalized = CultureHelper.run(cultureName, () => baseLocalizer.get(name));
      if (!baseLocalized.resourceNotFound) return baseLocalized;
    }
    return notFoundString(name);
  }

  protected getLocalizedStringOrNull(name: string, cultureName: string, tryDefaults = true): LocalizedString | undefined {
    const original = this.resource.contributors.getOrNull(cultureName, name);
    if (original) return original;
    if (!tryDefaults) return undefined;

    if (this.abpLocalizationOptions.tryToGetFromBaseCulture && cultureName.includes("-")) {
      const fromBase = this.resource.contributors.getOrNull(CultureHelper.getBaseCultureName(cultureName), name);
      if (fromBase) return fromBase;
    }

    if (this.abpLocalizationOptions.tryToGetFromDefaultCulture && this.resource.defaultCultureName) {
      const fromDefault = this.resource.contributors.getOrNull(this.resource.defaultCultureName, name);
      if (fromDefault) return fromDefault;
    }

    return undefined;
  }

  getAllStringsForCulture(cultureName: string, includeParentCultures = true, includeBaseLocalizers = true, includeDynamicContributors = true): LocalizedString[] {
    const allStrings = new Map<string, LocalizedString>();
    if (includeBaseLocalizers) {
      for (const baseLocalizer of this.baseLocalizers) {
        const baseStrings = CultureHelper.run(cultureName, () => baseLocalizer.getAllStrings(includeParentCultures, includeBaseLocalizers));
        for (const s of baseStrings) allStrings.set(s.name, s);
      }
    }
    this.fillOwnStrings(cultureName, allStrings, includeParentCultures, includeDynamicContributors);
    return [...allStrings.values()];
  }

  async getAllStringsForCultureAsync(cultureName: string, includeParentCultures = true, includeBaseLocalizers = true, includeDynamicContributors = true): Promise<LocalizedString[]> {
    const allStrings = new Map<string, LocalizedString>();
    if (includeBaseLocalizers) {
      for (const baseLocalizer of this.baseLocalizers) {
        const baseStrings = await CultureHelper.run(cultureName, () =>
          isAbpStringLocalizer(baseLocalizer) ? baseLocalizer.getAllStringsAsync(includeParentCultures, includeBaseLocalizers, includeDynamicContributors) : Promise.resolve(baseLocalizer.getAllStrings(includeParentCultures, includeBaseLocalizers)),
        );
        for (const s of baseStrings) allStrings.set(s.name, s);
      }
    }
    if (includeParentCultures) {
      if (this.resource.defaultCultureName) await this.resource.contributors.fillAsync(this.resource.defaultCultureName, allStrings, includeDynamicContributors);
      if (cultureName.includes("-")) await this.resource.contributors.fillAsync(CultureHelper.getBaseCultureName(cultureName), allStrings, includeDynamicContributors);
    }
    await this.resource.contributors.fillAsync(cultureName, allStrings, includeDynamicContributors);
    return [...allStrings.values()];
  }

  private fillOwnStrings(cultureName: string, into: Map<string, LocalizedString>, includeParentCultures: boolean, includeDynamicContributors: boolean): void {
    if (includeParentCultures) {
      if (this.resource.defaultCultureName) this.resource.contributors.fill(this.resource.defaultCultureName, into, includeDynamicContributors);
      if (cultureName.includes("-")) this.resource.contributors.fill(CultureHelper.getBaseCultureName(cultureName), into, includeDynamicContributors);
    }
    this.resource.contributors.fill(cultureName, into, includeDynamicContributors);
  }
}

/** Port of `AbpDictionaryBasedStringLocalizer.CultureWrapperStringLocalizer`: pins a culture (`WithCulture`). */
export class CultureWrapperStringLocalizer implements IAbpStringLocalizer {
  constructor(
    readonly cultureName: string,
    private readonly innerLocalizer: AbpDictionaryBasedStringLocalizer,
  ) {}

  get(name: string, ...args: unknown[]): LocalizedString {
    return args.length > 0 ? this.innerLocalizer.getLocalizedStringFormatted(name, this.cultureName, args) : this.innerLocalizer.getLocalizedString(name, this.cultureName);
  }

  t(name: string, ...args: unknown[]): string {
    return this.get(name, ...args).value;
  }

  withCulture(culture: string): IAbpStringLocalizer {
    return new CultureWrapperStringLocalizer(culture, this.innerLocalizer);
  }

  getAllStrings(includeParentCultures = true, includeBaseLocalizers = true, includeDynamicContributors = true): LocalizedString[] {
    return this.innerLocalizer.getAllStringsForCulture(this.cultureName, includeParentCultures, includeBaseLocalizers, includeDynamicContributors);
  }

  getAllStringsAsync(includeParentCultures = true, includeBaseLocalizers = true, includeDynamicContributors = true): Promise<LocalizedString[]> {
    return this.innerLocalizer.getAllStringsForCultureAsync(this.cultureName, includeParentCultures, includeBaseLocalizers, includeDynamicContributors);
  }

  getSupportedCulturesAsync(): Promise<string[]> {
    return this.innerLocalizer.getSupportedCulturesAsync();
  }
}

/**
 * Returned by the factory for a resource class that was never added to `AbpLocalizationOptions.resources`
 * (ABP delegates to the resx-based `ResourceManagerStringLocalizerFactory`, which likewise finds nothing).
 */
export class NullStringLocalizer implements IAbpStringLocalizer {
  static readonly instance = new NullStringLocalizer();
  get(name: string, ...args: unknown[]): LocalizedString {
    return createLocalizedString(name, args.length > 0 ? formatIndexed(name, ...args) : name, true);
  }
  t(name: string, ...args: unknown[]): string {
    return this.get(name, ...args).value;
  }
  withCulture(): IAbpStringLocalizer {
    return this;
  }
  getAllStrings(): LocalizedString[] {
    return [];
  }
  async getAllStringsAsync(): Promise<LocalizedString[]> {
    return [];
  }
  async getSupportedCulturesAsync(): Promise<string[]> {
    return [];
  }
}
