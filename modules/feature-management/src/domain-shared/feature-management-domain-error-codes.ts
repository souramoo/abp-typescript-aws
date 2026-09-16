import { BusinessException } from "@abp/core";

/** Port of `FeatureManagementDomainErrorCodes`. */
export const FeatureManagementDomainErrorCodes = {
  FeatureValueInvalid: "Volo.Abp.FeatureManagement:InvalidFeatureValue",
} as const;

/** Port of `FeatureValueInvalidException`: the value does not satisfy the validator of the feature's value type. */
export class FeatureValueInvalidException extends BusinessException {
  constructor(name: string) {
    super({ code: FeatureManagementDomainErrorCodes.FeatureValueInvalid, message: `${name} feature value is not valid!` });
    this.withData("0", name);
  }
}
