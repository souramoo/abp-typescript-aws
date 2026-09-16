import { createToken, type Class } from "../dependency-injection/service-token.js";

/** Minimal `IStringLocalizer` contract; the full implementation lives in `@abp/localization`. */
export interface LocalizedString {
  readonly name: string;
  readonly value: string;
  readonly resourceNotFound: boolean;
}
export interface IStringLocalizer {
  get(name: string, ...args: unknown[]): LocalizedString;
  /** Convenience: localized text or the key itself. */
  t(name: string, ...args: unknown[]): string;
  getAllStrings(includeParentCultures?: boolean, includeBaseLocalizers?: boolean, includeDynamicContributors?: boolean): LocalizedString[];
  withCulture(culture: string): IStringLocalizer;
}
export interface IStringLocalizerFactory {
  create(resource: LocalizationResourceType): IStringLocalizer;
  createByResourceName(resourceName: string): IStringLocalizer;
  createDefaultOrNull(): IStringLocalizer | undefined;
}
export const IStringLocalizerFactory = createToken<IStringLocalizerFactory>("IStringLocalizerFactory");

/** A localization resource is identified by a class (port of `typeof(MyResource)`). */
export type LocalizationResourceType = Class;

/** Port of `ILocalizableString`. */
export interface ILocalizableString {
  localize(factory: IStringLocalizerFactory): LocalizedString;
}

export class FixedLocalizableString implements ILocalizableString {
  constructor(readonly value: string) {}
  localize(): LocalizedString {
    return { name: this.value, value: this.value, resourceNotFound: false };
  }
}

export class LocalizableString implements ILocalizableString {
  constructor(
    readonly resource: LocalizationResourceType,
    readonly name: string,
  ) {}
  localize(factory: IStringLocalizerFactory): LocalizedString {
    const result = factory.create(this.resource).get(this.name);
    if (!result.resourceNotFound) return result;
    return factory.createDefaultOrNull()?.get(this.name) ?? result;
  }
  static create(resource: LocalizationResourceType, name: string): LocalizableString {
    return new LocalizableString(resource, name);
  }
}

export function localizableString(resource: LocalizationResourceType, name: string): LocalizableString {
  return new LocalizableString(resource, name);
}
export function fixedString(value: string): FixedLocalizableString {
  return new FixedLocalizableString(value);
}
