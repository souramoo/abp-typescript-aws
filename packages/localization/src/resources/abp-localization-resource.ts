import type { JsonLocalizationFile } from "../json/json-localization-file.js";
import { LocalizationResourceName } from "../localization-resource-name.js";

/** Port of `AbpLocalizationResource` ("AbpLocalization"). */
@LocalizationResourceName("AbpLocalization")
export class AbpLocalizationResource {}

/** Port of `Volo/Abp/Localization/Resources/AbpLocalization/en.json`. */
export const abpLocalizationEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    "DisplayName:Abp.Localization.DefaultLanguage": "Default language",
    "Description:Abp.Localization.DefaultLanguage": "The default language of the application.",
  },
};
