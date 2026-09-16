import type { ValidationResult } from "@abp/core";

/** Port of `new ValidationResult(errorMessage, memberNames)`. */
export function createValidationResult(errorMessage: string, ...memberNames: string[]): ValidationResult {
  return { errorMessage, memberNames };
}

/** Port of `IAbpValidationResult` / `AbpValidationResult`. */
export interface IAbpValidationResult {
  readonly errors: ValidationResult[];
}

export class AbpValidationResult implements IAbpValidationResult {
  readonly errors: ValidationResult[] = [];
}

/** Port of `ValidationHelper`. */
export const ValidationHelper = {
  emailRegEx: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/i,
  isValidEmailAddress(email: string | null | undefined): boolean {
    return !!email && ValidationHelper.emailRegEx.test(email);
  },
};
