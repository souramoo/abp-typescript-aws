import { createClassMarker, createMethodMetadata, type Class } from "@abp/core";

/** Port of the `IValidationEnabled` marker interface: `@ValidationEnabled()` classes get the `ValidationInterceptor`. */
export const ValidationEnabled = createClassMarker("IValidationEnabled");

const disableValidationMetadata = createMethodMetadata<boolean>("DisableValidation");
const enableValidationMetadata = createMethodMetadata<boolean>("EnableValidation");
const requiredParametersMetadata = createMethodMetadata<readonly number[]>("RequiredParameters");

type ClassOrMemberDecorator = (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void;

/** Port of `[DisableValidation]`: on a method, a property (skips recursive validation of it) or a whole class. */
export function DisableValidation(): ClassOrMemberDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) disableValidationMetadata.setForClass(target as Class, true);
    else disableValidationMetadata(true)(target, propertyKey);
  };
}

/** Port of `[EnableValidation]`: re-enables validation for a method of a `@DisableValidation()` class. */
export function EnableValidation(): (target: object, propertyKey: string | symbol) => void {
  return enableValidationMetadata(true);
}

/**
 * .NET derives "may this argument be null?" from the parameter type; TypeScript erases it. Arguments are
 * therefore allowed to be null/undefined unless their positions are listed here: `@RequiredParameters(0)`.
 */
export function RequiredParameters(...parameterIndexes: number[]): (target: object, propertyKey: string | symbol) => void {
  return requiredParametersMetadata(parameterIndexes);
}

export const ValidationMetadata = {
  isDisabledForMethod(type: Class | undefined, method: string): boolean {
    return disableValidationMetadata.get(type, method) === true;
  },
  isDisabledForClass(type: Class | undefined): boolean {
    return disableValidationMetadata.getForClass(type) === true;
  },
  isDisabledForProperty(type: Class | undefined, property: string): boolean {
    return disableValidationMetadata.get(type, property) === true;
  },
  isEnabledForMethod(type: Class | undefined, method: string): boolean {
    return enableValidationMetadata.get(type, method) === true;
  },
  requiredParameterIndexes(type: Class | undefined, method: string): readonly number[] {
    return requiredParametersMetadata.get(type, method) ?? [];
  },
};
