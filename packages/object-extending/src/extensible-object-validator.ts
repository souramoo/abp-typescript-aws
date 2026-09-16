import { Check, IServiceProviderToken, Transient, type Class, type IServiceProvider, type ValidationResult } from "@abp/core";
import { AbpValidationException, ValidationContext, zodIssuesToValidationResults, type IObjectValidationContributor, type ObjectValidationContext } from "@abp/validation";
import { getProperty, hasExtraProperties, type IHasExtraProperties } from "./data/has-extra-properties.js";
import { ObjectExtensionManager } from "./object-extension-manager.js";
import type { ObjectExtensionInfo } from "./object-extension-info.js";
import type { ObjectExtensionPropertyInfo } from "./object-extension-property-info.js";
import { ObjectExtensionPropertyValidationContext, ObjectExtensionValidationContext } from "./object-extension-validation-context.js";

/**
 * Port of the static `ExtensibleObjectValidator`, doubling as the `IObjectValidationContributor` that validates the
 * extra properties of plain `IHasExtraProperties` objects (`ExtensibleObject` validates itself via `validate()`).
 */
@Transient()
export class ExtensibleObjectValidator implements IObjectValidationContributor {
  static readonly inject = [IServiceProviderToken] as const;
  constructor(private readonly serviceProvider: IServiceProvider) {}

  async addErrorsAsync(context: ObjectValidationContext): Promise<void> {
    const target = context.validatingObject;
    if (!hasExtraProperties(target) || isSelfValidating(target)) return;
    ExtensibleObjectValidator.addValidationErrors(target, context.errors, new ValidationContext(target, this.serviceProvider));
  }

  static checkValue(extensibleObject: IHasExtraProperties, propertyName: string, value: unknown): void {
    const validationErrors = ExtensibleObjectValidator.getPropertyValidationErrors(extensibleObject, propertyName, value);
    if (validationErrors.length > 0) throw new AbpValidationException(validationErrors);
  }

  /** ABP's `IsValid` returns `.Any()` (inverted); this returns true when there are no errors. */
  static isValid(extensibleObject: IHasExtraProperties, objectValidationContext?: ValidationContext): boolean {
    return ExtensibleObjectValidator.getValidationErrors(extensibleObject, objectValidationContext).length === 0;
  }

  static isPropertyValid(extensibleObject: IHasExtraProperties, propertyName: string, value: unknown, objectValidationContext?: ValidationContext): boolean {
    return ExtensibleObjectValidator.getPropertyValidationErrors(extensibleObject, propertyName, value, objectValidationContext).length === 0;
  }

  static getValidationErrors(extensibleObject: IHasExtraProperties, objectValidationContext?: ValidationContext): ValidationResult[] {
    const validationErrors: ValidationResult[] = [];
    ExtensibleObjectValidator.addValidationErrors(extensibleObject, validationErrors, objectValidationContext);
    return validationErrors;
  }

  static getPropertyValidationErrors(extensibleObject: IHasExtraProperties, propertyName: string, value: unknown, objectValidationContext?: ValidationContext): ValidationResult[] {
    const validationErrors: ValidationResult[] = [];
    ExtensibleObjectValidator.addPropertyValidationErrors(extensibleObject, validationErrors, propertyName, value, objectValidationContext);
    return validationErrors;
  }

  static addValidationErrors(extensibleObject: IHasExtraProperties, validationErrors: ValidationResult[], objectValidationContext?: ValidationContext): void {
    const context = objectValidationContext ?? new ValidationContext(extensibleObject);
    const objectExtensionInfo = ObjectExtensionManager.instance.getOrNull(typeOf(extensibleObject));
    if (!objectExtensionInfo) return;
    for (const property of objectExtensionInfo.getProperties()) {
      addPropertyErrors(extensibleObject, validationErrors, context, property, getProperty(extensibleObject, property.name));
    }
    executeCustomObjectValidationActions(extensibleObject, validationErrors, context, objectExtensionInfo);
  }

  static addPropertyValidationErrors(extensibleObject: IHasExtraProperties, validationErrors: ValidationResult[], propertyName: string, value: unknown, objectValidationContext?: ValidationContext): void {
    Check.notNullOrWhiteSpace(propertyName, "propertyName");
    const context = objectValidationContext ?? new ValidationContext(extensibleObject);
    const property = ObjectExtensionManager.instance.getOrNull(typeOf(extensibleObject))?.getPropertyOrNull(propertyName);
    if (!property) return;
    addPropertyErrors(extensibleObject, validationErrors, context, property, value);
  }
}

function typeOf(value: object): Class {
  return value.constructor as Class;
}

function isSelfValidating(target: object): boolean {
  return "validate" in target && typeof target.validate === "function";
}

function addPropertyErrors(extensibleObject: IHasExtraProperties, validationErrors: ValidationResult[], objectValidationContext: ValidationContext, property: ObjectExtensionPropertyInfo, value: unknown): void {
  const result = property.getSchema().safeParse(value);
  if (!result.success) validationErrors.push(...zodIssuesToValidationResults(result.error.issues, value, property.name));

  if (property.validators.length === 0) return;
  const context = new ObjectExtensionPropertyValidationContext(property, extensibleObject, validationErrors, objectValidationContext, value);
  for (const validator of property.validators) validator(context);
}

function executeCustomObjectValidationActions(extensibleObject: IHasExtraProperties, validationErrors: ValidationResult[], objectValidationContext: ValidationContext, objectExtensionInfo: ObjectExtensionInfo): void {
  if (objectExtensionInfo.validators.length === 0) return;
  const context = new ObjectExtensionValidationContext(objectExtensionInfo, extensibleObject, validationErrors, objectValidationContext);
  for (const validator of objectExtensionInfo.validators) validator(context);
}
