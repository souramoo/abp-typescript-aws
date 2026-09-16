import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `AbpFeatureManagementResource` ("AbpFeatureManagement"). */
@LocalizationResourceName("AbpFeatureManagement")
export class AbpFeatureManagementResource {}

/** Port of `Volo/Abp/FeatureManagement/Localization/Domain/en.json`. */
export const abpFeatureManagementEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    Features: "Features",
    NoFeatureFoundMessage: "There isn't any available feature.",
    ManageHostFeatures: "Manage host features",
    ManageHostFeaturesText: "You can manage the host side features by clicking the following button.",
    "Permission:FeatureManagement": "Feature management",
    "Permission:FeatureManagement.ManageHostFeatures": "Manage host features",
    "Volo.Abp.FeatureManagement:InvalidFeatureValue": "{0} feature value is not valid!",
    "Menu:FeatureManagement": "Feature management",
    ResetToDefault: "Reset to default",
    ResetedToDefault: "Reseted to default",
    AreYouSure: "Are you sure?",
    AreYouSureToResetToDefault: "Are you sure to reset to default?",
  },
};
