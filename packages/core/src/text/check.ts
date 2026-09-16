import { AbpException } from "../exception-handling/exceptions.js";

export class ArgumentException extends AbpException {
  constructor(
    message: string,
    readonly paramName?: string,
  ) {
    super(paramName ? `${message} (Parameter '${paramName}')` : message);
  }
}
export class ArgumentNullException extends ArgumentException {
  constructor(paramName: string) {
    super("Value cannot be null.", paramName);
  }
}

/** Port of `Volo.Abp.Check`. */
export const Check = {
  notNull<T>(value: T | null | undefined, parameterName: string, message?: string): T {
    if (value === null || value === undefined) throw message ? new ArgumentException(message, parameterName) : new ArgumentNullException(parameterName);
    return value;
  },
  notNullOrEmpty(value: string | null | undefined, parameterName: string, maxLength?: number, minLength = 0): string {
    if (value === null || value === undefined || value === "") throw new ArgumentException(`${parameterName} can not be null or empty!`, parameterName);
    return Check.length(value, parameterName, maxLength, minLength);
  },
  notNullOrWhiteSpace(value: string | null | undefined, parameterName: string, maxLength?: number, minLength = 0): string {
    if (value === null || value === undefined || value.trim() === "") throw new ArgumentException(`${parameterName} can not be null, empty or white space!`, parameterName);
    return Check.length(value, parameterName, maxLength, minLength);
  },
  notNullOrEmptyArray<T>(value: readonly T[] | null | undefined, parameterName: string): readonly T[] {
    if (!value || value.length === 0) throw new ArgumentException(`${parameterName} can not be null or empty!`, parameterName);
    return value;
  },
  length(value: string | null | undefined, parameterName: string, maxLength?: number, minLength = 0): string {
    if (minLength > 0) {
      if (value === null || value === undefined || value === "") throw new ArgumentException(`${parameterName} can not be null or empty!`, parameterName);
      if (value.length < minLength) throw new ArgumentException(`${parameterName} length must be equal to or bigger than ${minLength}!`, parameterName);
    }
    if (value != null && maxLength !== undefined && value.length > maxLength) {
      throw new ArgumentException(`${parameterName} length must be equal to or lower than ${maxLength}!`, parameterName);
    }
    return value ?? "";
  },
  positive(value: number, parameterName: string): number {
    if (value <= 0) throw new ArgumentException(`${parameterName} is not positive!`, parameterName);
    return value;
  },
  range(value: number, parameterName: string, minimumValue: number, maximumValue = Number.MAX_SAFE_INTEGER): number {
    if (value < minimumValue || value > maximumValue) throw new ArgumentException(`${parameterName} is out of range min: ${minimumValue} - max: ${maximumValue}`, parameterName);
    return value;
  },
};
