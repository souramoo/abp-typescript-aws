import { Check, isNullOrWhiteSpace } from "@abp/core";

/** Port of `ILanguageInfo`. */
export interface ILanguageInfo {
  readonly cultureName: string;
  readonly uiCultureName: string;
  readonly displayName: string;
}

/** Port of `LanguageInfo`. */
export class LanguageInfo implements ILanguageInfo {
  cultureName!: string;
  uiCultureName!: string;
  displayName!: string;
  twoLetterISOLanguageName!: string;

  constructor(cultureName: string, uiCultureName?: string, displayName?: string) {
    this.changeCulture(cultureName, uiCultureName, displayName);
  }

  changeCulture(cultureName: string, uiCultureName?: string, displayName?: string): void {
    this.cultureName = Check.notNullOrWhiteSpace(cultureName, "cultureName");
    this.uiCultureName = isNullOrWhiteSpace(uiCultureName) ? cultureName : uiCultureName;
    this.displayName = isNullOrWhiteSpace(displayName) ? cultureName : displayName;
    this.twoLetterISOLanguageName = twoLetterLanguageOf(cultureName);
  }
}

function twoLetterLanguageOf(cultureName: string): string {
  try {
    return new Intl.Locale(cultureName).language;
  } catch {
    return cultureName.split("-")[0] ?? cultureName;
  }
}

/** Port of `LanguageInfoExtensions.FindByCulture`. */
export function findByCulture<T extends ILanguageInfo>(languages: Iterable<T>, cultureName: string, uiCultureName?: string): T | undefined {
  const ui = uiCultureName ?? cultureName;
  const list = [...languages];
  return list.find((l) => l.cultureName === cultureName && l.uiCultureName === ui) ?? list.find((l) => l.cultureName === cultureName) ?? list.find((l) => l.uiCultureName === ui);
}
