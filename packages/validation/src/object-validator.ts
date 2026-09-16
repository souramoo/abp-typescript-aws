import { createToken, IServiceProviderToken, optionsToken, Transient, type IOptions, type IServiceProvider, type ValidationResult } from "@abp/core";
import { AbpValidationException } from "./abp-validation-exception.js";
import { AbpValidationOptions } from "./abp-validation-options.js";
import { ObjectValidationContext } from "./object-validation-contributor.js";
import { createValidationResult } from "./validation-result.js";

/** Port of `IObjectValidator`. */
export interface IObjectValidator {
  validateAsync(validatingObject: unknown, name?: string, allowNull?: boolean): Promise<void>;
  getErrorsAsync(validatingObject: unknown, name?: string, allowNull?: boolean): Promise<ValidationResult[]>;
}
export const IObjectValidator = createToken<IObjectValidator>("IObjectValidator");

/** Port of `ObjectValidator`: runs every `AbpValidationOptions.objectValidationContributors` in a new scope. */
@Transient(IObjectValidator)
export class ObjectValidator implements IObjectValidator {
  static readonly inject = [optionsToken(AbpValidationOptions), IServiceProviderToken] as const;
  protected readonly options: AbpValidationOptions;

  constructor(
    options: IOptions<AbpValidationOptions>,
    protected readonly serviceProvider: IServiceProvider,
  ) {
    this.options = options.value;
  }

  async validateAsync(validatingObject: unknown, name?: string, allowNull = false): Promise<void> {
    const errors = await this.getErrorsAsync(validatingObject, name, allowNull);
    if (errors.length > 0) throw new AbpValidationException("Object state is not valid! See validationErrors for details.", errors);
  }

  async getErrorsAsync(validatingObject: unknown, name?: string, allowNull = false): Promise<ValidationResult[]> {
    if (validatingObject === null || validatingObject === undefined) {
      if (allowNull) return [];
      return [name === undefined ? createValidationResult("Given object is null!") : createValidationResult(`${name} is null!`, name)];
    }
    if (typeof validatingObject !== "object") return [];

    const context = new ObjectValidationContext(validatingObject);
    await using scope = this.serviceProvider.createScope();
    for (const contributorType of this.options.objectValidationContributors) {
      const contributor = scope.serviceProvider.getRequired(contributorType);
      await contributor.addErrorsAsync(context);
    }
    return context.errors;
  }
}
