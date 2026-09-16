import type { IServiceProvider, ServiceKey, ServiceType, ValidationResult } from "@abp/core";

/** Port of `System.ComponentModel.DataAnnotations.ValidationContext`. */
export class ValidationContext {
  readonly items: Map<unknown, unknown>;
  memberName: string | undefined;
  displayName: string | undefined;

  constructor(
    readonly objectInstance: object,
    readonly serviceProvider?: IServiceProvider,
    items?: Map<unknown, unknown>,
  ) {
    this.items = items ?? new Map();
  }

  getService<K extends ServiceKey>(key: K): ServiceType<K> | undefined {
    return this.serviceProvider?.get(key);
  }
}

/** Port of `IValidatableObject`: objects that validate themselves (may be async). */
export interface IValidatableObject {
  validate(validationContext: ValidationContext): ValidationResult[] | Promise<ValidationResult[]>;
}

export function isValidatableObject(value: unknown): value is IValidatableObject {
  return typeof value === "object" && value !== null && "validate" in value && typeof value.validate === "function";
}
