import { AbpException, type ILocalizableString, type IStringLocalizerFactory, type LocalizableString, type LocalizedString } from "@abp/core";
import { getLocalizationResourceName } from "./localization-resource-name.js";
import { isAbpStringLocalizerFactory } from "./abp-string-localizer-factory.js";

/** Port of `IAsyncLocalizableString`. */
export interface IAsyncLocalizableString {
  localizeAsync(stringLocalizerFactory: IStringLocalizerFactory): Promise<LocalizedString>;
}

export function isAsyncLocalizableString(value: ILocalizableString): value is ILocalizableString & IAsyncLocalizableString {
  return "localizeAsync" in value && typeof value.localizeAsync === "function";
}

/**
 * Port of `LocalizableString(name, resourceName)`: a localizable string that refers to its resource by name
 * (the core `LocalizableString` refers to it by class). Falls back to the default resource like ABP does.
 */
export class ResourceNameLocalizableString implements ILocalizableString, IAsyncLocalizableString {
  constructor(
    readonly name: string,
    readonly resourceName?: string,
  ) {
    if (!name) throw new AbpException("name can not be null or empty!");
  }

  localize(stringLocalizerFactory: IStringLocalizerFactory): LocalizedString {
    const localizer = this.resourceName === undefined ? stringLocalizerFactory.createDefaultOrNull() : (createByResourceNameOrNull(stringLocalizerFactory, this.resourceName) ?? stringLocalizerFactory.createDefaultOrNull());
    if (!localizer) return { name: this.name, value: this.name, resourceNotFound: true };
    const result = localizer.get(this.name);
    if (result.resourceNotFound && this.resourceName !== undefined) {
      const fallback = stringLocalizerFactory.createDefaultOrNull()?.get(this.name);
      if (fallback) return fallback;
    }
    return result;
  }

  async localizeAsync(stringLocalizerFactory: IStringLocalizerFactory): Promise<LocalizedString> {
    if (this.resourceName !== undefined && isAbpStringLocalizerFactory(stringLocalizerFactory)) {
      const localizer = (await stringLocalizerFactory.createByResourceNameOrNullAsync(this.resourceName)) ?? stringLocalizerFactory.createDefaultOrNull();
      if (!localizer) throw new AbpException("Set resourceName or configure the default localization resource type (in the AbpLocalizationOptions)!");
      const result = localizer.get(this.name);
      if (result.resourceNotFound) return stringLocalizerFactory.createDefaultOrNull()?.get(this.name) ?? result;
      return result;
    }
    return this.localize(stringLocalizerFactory);
  }
}

function createByResourceNameOrNull(factory: IStringLocalizerFactory, resourceName: string): ReturnType<IStringLocalizerFactory["createDefaultOrNull"]> {
  if (isAbpStringLocalizerFactory(factory)) return factory.createByResourceNameOrNull(resourceName);
  try {
    return factory.createByResourceName(resourceName);
  } catch {
    return undefined;
  }
}

/** Port of `LocalizableStringExtensions.LocalizeAsync`. */
export async function localizeAsync(localizableString: ILocalizableString, stringLocalizerFactory: IStringLocalizerFactory): Promise<LocalizedString> {
  if (isAsyncLocalizableString(localizableString)) return localizableString.localizeAsync(stringLocalizerFactory);
  return localizableString.localize(stringLocalizerFactory);
}

/** Port of `IHasNameWithLocalizableDisplayName`. */
export interface IHasNameWithLocalizableDisplayName {
  readonly name: string;
  readonly displayName: ILocalizableString | undefined;
}

/** Port of `HasNameWithLocalizableDisplayNameExtensions.GetLocalizedDisplayName`. */
export function getLocalizedDisplayName(source: IHasNameWithLocalizableDisplayName, stringLocalizerFactory: IStringLocalizerFactory, localizationNamePrefix = "DisplayName:"): string {
  if (source.displayName) return source.displayName.localize(stringLocalizerFactory).value;
  const defaultLocalizer = stringLocalizerFactory.createDefaultOrNull();
  if (!defaultLocalizer) return source.name;
  const localized = defaultLocalizer.get(`${localizationNamePrefix}${source.name}`);
  if (!localized.resourceNotFound || localizationNamePrefix === "") return localized.value;
  return defaultLocalizer.get(source.name).value;
}

/** The resource name of a core `LocalizableString` (`LocalizableString.ResourceName`). */
export function resourceNameOf(localizableString: LocalizableString): string {
  return getLocalizationResourceName(localizableString.resource);
}
