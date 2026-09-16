import { CultureHelper, TypeList, type Class, type NameValue } from "@abp/core";
import type { LanguageInfo } from "./language-info.js";
import type { ILocalizationResourceContributor } from "./localization-resource-contributor.js";
import { LocalizationResourceDictionary } from "./localization-resource-dictionary.js";

/** Port of `AbpLocalizationOptions` (+ `AbpLocalizationOptionsExtensions` as instance methods). */
export class AbpLocalizationOptions {
  readonly resources = new LocalizationResourceDictionary();
  /** Used as the default resource when a resource was not specified on a localization operation. */
  defaultResourceType: Class | undefined;
  readonly globalContributors = new TypeList<ILocalizationResourceContributor>();
  readonly languages: LanguageInfo[] = [];
  readonly languagesMap = new Map<string, NameValue[]>();
  readonly languageFilesMap = new Map<string, NameValue[]>();
  tryToGetFromBaseCulture = true;
  tryToGetFromDefaultCulture = true;

  addLanguagesMapOrUpdate(packageName: string, ...maps: NameValue[]): this {
    for (const map of maps) addOrUpdate(this.languagesMap, packageName, map);
    return this;
  }

  getLanguagesMap(packageName: string, language: string): string {
    return this.languagesMap.get(packageName)?.find((x) => x.name === language)?.value ?? language;
  }

  getCurrentUICultureLanguagesMap(packageName: string): string {
    return this.getLanguagesMap(packageName, CultureHelper.currentUICulture);
  }

  addLanguageFilesMapOrUpdate(packageName: string, ...maps: NameValue[]): this {
    for (const map of maps) addOrUpdate(this.languageFilesMap, packageName, map);
    return this;
  }

  getLanguageFilesMap(packageName: string, language: string): string {
    return this.languageFilesMap.get(packageName)?.find((x) => x.name === language)?.value ?? language;
  }

  getCurrentUICultureLanguageFilesMap(packageName: string): string {
    return this.getLanguageFilesMap(packageName, CultureHelper.currentUICulture);
  }
}

function addOrUpdate(maps: Map<string, NameValue[]>, packageName: string, value: NameValue): void {
  const existing = maps.get(packageName);
  if (!existing) {
    maps.set(packageName, [value]);
    return;
  }
  const found = existing.find((x) => x.name === value.name);
  if (found) found.value = value.value;
  else existing.push(value);
}
