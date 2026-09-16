import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `AbpFeatureResource` ("AbpFeature"). */
@LocalizationResourceName("AbpFeature")
export class AbpFeatureResource {}

/** Port of `Volo/Abp/Features/Localization/en.json`. */
export const abpFeatureEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    "Volo.Feature:010001": "Feature is not enabled: {FeatureName}",
    "Volo.Feature:010002": "Required features are not enabled. All of these features must be enabled: {FeatureNames}",
    "Volo.Feature:010003": "Required features are not enabled. At least one of these features must be enabled: {FeatureNames}",
  },
};
