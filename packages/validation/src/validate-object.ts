import type { IServiceProvider, ValidationResult } from "@abp/core";
import { AbpValidationException } from "./abp-validation-exception.js";
import { AbpValidationOptions } from "./abp-validation-options.js";
import { ObjectValidationContext } from "./object-validation-contributor.js";
import { ZodObjectValidationContributor } from "./zod-object-validation-contributor.js";

export interface ValidateObjectInit {
  serviceProvider?: IServiceProvider;
  configureOptions?: (options: AbpValidationOptions) => void;
}

/** Container-free validation with the built-in zod contributor (handy for tests and plain scripts). */
export async function getValidationErrors(validatingObject: object, init: ValidateObjectInit = {}): Promise<ValidationResult[]> {
  const options = new AbpValidationOptions();
  init.configureOptions?.(options);
  const context = new ObjectValidationContext(validatingObject);
  await new ZodObjectValidationContributor({ value: options }, init.serviceProvider).addErrorsAsync(context);
  return context.errors;
}

/** Throws `AbpValidationException` when {@link getValidationErrors} finds anything. */
export async function validateObject(validatingObject: object, init: ValidateObjectInit = {}): Promise<void> {
  const errors = await getValidationErrors(validatingObject, init);
  if (errors.length > 0) throw new AbpValidationException("Object state is not valid! See validationErrors for details.", errors);
}
