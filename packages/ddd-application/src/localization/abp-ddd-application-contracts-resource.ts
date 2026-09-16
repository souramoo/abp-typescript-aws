import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `AbpDddApplicationContractsResource` ("AbpDddApplicationContracts"). */
@LocalizationResourceName("AbpDddApplicationContracts")
export class AbpDddApplicationContractsResource {}

/** Port of `Volo/Abp/Application/Localization/Resources/AbpDdd/en.json`. */
export const abpDddApplicationContractsEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    MaxResultCountExceededExceptionMessage: "{0} can not be more than {1}! Increase {2}.{3} on the server side to allow more results.",
  },
};
