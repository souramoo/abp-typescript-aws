import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `AbpAuthorizationResource` ("AbpAuthorization"). */
@LocalizationResourceName("AbpAuthorization")
export class AbpAuthorizationResource {}

/** Port of `Volo/Abp/Authorization/Localization/en.json`. */
export const abpAuthorizationEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    "Volo.Authorization:010001": "Authorization failed! Given policy has not granted.",
    "Volo.Authorization:010002": "Authorization failed! Given policy has not granted: {PolicyName}",
    "Volo.Authorization:010003": "Authorization failed! Given policy has not granted for given resource: {ResourceName}",
    "Volo.Authorization:010004": "Authorization failed! Given requirement has not granted for given resource: {ResourceName}",
    "Volo.Authorization:010005": "Authorization failed! Given requirements has not granted for given resource: {ResourceName}",
  },
};
