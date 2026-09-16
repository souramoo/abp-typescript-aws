import { CultureHelper } from "@abp/core";

/** Port of `LocalizationSettingNames`. */
export const LocalizationSettingNames = {
  DefaultLanguage: "Abp.Localization.DefaultLanguage",
} as const;

/** Port of `LocalizationSettingHelper.ParseLanguageSetting`: `"en-US;en"` → `["en-US", "en"]`. */
export function parseLanguageSetting(settingValue: string, defaultCultureName = "en"): { cultureName: string; uiCultureName: string } {
  if (!settingValue.includes(";")) {
    return CultureHelper.isValidCultureCode(settingValue) ? { cultureName: settingValue, uiCultureName: settingValue } : { cultureName: defaultCultureName, uiCultureName: defaultCultureName };
  }
  const [culture, uiCulture, ...rest] = settingValue.split(";");
  if (rest.length === 0 && culture && uiCulture && CultureHelper.isValidCultureCode(culture) && CultureHelper.isValidCultureCode(uiCulture)) {
    return { cultureName: culture, uiCultureName: uiCulture };
  }
  return { cultureName: defaultCultureName, uiCultureName: defaultCultureName };
}
