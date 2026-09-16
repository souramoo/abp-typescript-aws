import { Check, createToken, type ValidationResult } from "@abp/core";

/** Port of `ObjectValidationContext`. */
export class ObjectValidationContext {
  readonly validatingObject: object;
  readonly errors: ValidationResult[] = [];

  constructor(validatingObject: object) {
    this.validatingObject = Check.notNull(validatingObject, "validatingObject");
  }
}

/** Port of `IObjectValidationContributor`: listed in `AbpValidationOptions.objectValidationContributors`. */
export interface IObjectValidationContributor {
  addErrorsAsync(context: ObjectValidationContext): Promise<void>;
}
export const IObjectValidationContributor = createToken<IObjectValidationContributor>("IObjectValidationContributor");
