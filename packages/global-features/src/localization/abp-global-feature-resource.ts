import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `AbpGlobalFeatureResource` ("AbpGlobalFeature"). */
@LocalizationResourceName("AbpGlobalFeature")
export class AbpGlobalFeatureResource {}

/** Port of `Volo/Abp/GlobalFeatures/Localization/en.json`. */
export const abpGlobalFeatureEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    "Volo.GlobalFeature:010001": "The '{ServiceName}' service needs to enable '{GlobalFeatureName}' feature.",
  },
};
