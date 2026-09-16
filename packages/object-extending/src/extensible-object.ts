import type { ValidationResult } from "@abp/core";
import type { IValidatableObject, ValidationContext } from "@abp/validation";
import { ExtraPropertyDictionary } from "./data/extra-property-dictionary.js";
import { setDefaultsForExtraProperties, type IHasExtraProperties } from "./data/has-extra-properties.js";
import { ExtensibleObjectValidator } from "./extensible-object-validator.js";

/** Port of `ExtensibleObject`: an `IHasExtraProperties` that validates its extra properties through `IValidatableObject`. */
export class ExtensibleObject implements IHasExtraProperties, IValidatableObject {
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(setDefaultsForExtraPropertiesOnCreate = true) {
    if (setDefaultsForExtraPropertiesOnCreate) setDefaultsForExtraProperties(this, new.target);
  }

  validate(validationContext: ValidationContext): ValidationResult[] {
    return ExtensibleObjectValidator.getValidationErrors(this, validationContext);
  }
}
