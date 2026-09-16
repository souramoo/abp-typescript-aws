import { Check, type IServiceProvider, type ValidationResult } from "@abp/core";
import type { ValidationContext } from "@abp/validation";
import type { IHasExtraProperties } from "./data/has-extra-properties.js";
import type { ObjectExtensionInfo } from "./object-extension-info.js";
import type { ObjectExtensionPropertyInfo } from "./object-extension-property-info.js";

/** Port of `ObjectExtensionPropertyValidationContext`. */
export class ObjectExtensionPropertyValidationContext {
  readonly extensionPropertyInfo: ObjectExtensionPropertyInfo;
  readonly validatingObject: IHasExtraProperties;
  readonly validationErrors: ValidationResult[];
  readonly validationContext: ValidationContext;

  constructor(
    objectExtensionPropertyInfo: ObjectExtensionPropertyInfo,
    validatingObject: IHasExtraProperties,
    validationErrors: ValidationResult[],
    validationContext: ValidationContext,
    readonly value: unknown,
  ) {
    this.extensionPropertyInfo = Check.notNull(objectExtensionPropertyInfo, "objectExtensionPropertyInfo");
    this.validatingObject = Check.notNull(validatingObject, "validatingObject");
    this.validationErrors = Check.notNull(validationErrors, "validationErrors");
    this.validationContext = Check.notNull(validationContext, "validationContext");
  }

  /** Undefined when validation was triggered by `setProperty` outside the container. */
  get serviceProvider(): IServiceProvider | undefined {
    return this.validationContext.serviceProvider;
  }
}

/** Port of `ObjectExtensionValidationContext`. */
export class ObjectExtensionValidationContext {
  readonly objectExtensionInfo: ObjectExtensionInfo;
  readonly validatingObject: IHasExtraProperties;
  readonly validationErrors: ValidationResult[];
  readonly validationContext: ValidationContext;

  constructor(objectExtensionInfo: ObjectExtensionInfo, validatingObject: IHasExtraProperties, validationErrors: ValidationResult[], validationContext: ValidationContext) {
    this.objectExtensionInfo = Check.notNull(objectExtensionInfo, "objectExtensionInfo");
    this.validatingObject = Check.notNull(validatingObject, "validatingObject");
    this.validationErrors = Check.notNull(validationErrors, "validationErrors");
    this.validationContext = Check.notNull(validationContext, "validationContext");
  }

  get serviceProvider(): IServiceProvider | undefined {
    return this.validationContext.serviceProvider;
  }
}
