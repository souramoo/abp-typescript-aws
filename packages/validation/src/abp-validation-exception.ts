import { AbpException, LogLevel, type IExceptionWithSelfLogging, type IHasLogLevel, type IHasValidationErrors, type ILogger, type ValidationResult } from "@abp/core";
import { createValidationResult } from "./validation-result.js";

/**
 * Port of `AbpValidationException`. Constructor forms: `(message)`, `(validationErrors)`,
 * `(message, validationErrors)` and `(message, { cause })`.
 */
export class AbpValidationException extends AbpException implements IHasLogLevel, IHasValidationErrors, IExceptionWithSelfLogging {
  readonly validationErrors: ValidationResult[];
  logLevel: LogLevel = LogLevel.Warning;

  constructor(message?: string);
  constructor(validationErrors: ValidationResult[]);
  constructor(message: string, validationErrors: ValidationResult[]);
  constructor(message: string, options: { cause?: unknown });
  constructor(messageOrErrors?: string | ValidationResult[], errorsOrOptions?: ValidationResult[] | { cause?: unknown }) {
    const message = typeof messageOrErrors === "string" ? messageOrErrors : undefined;
    const cause = errorsOrOptions !== undefined && !Array.isArray(errorsOrOptions) ? errorsOrOptions.cause : undefined;
    super(message ?? "Validation failed. See validationErrors for details.", { cause });
    this.validationErrors = Array.isArray(messageOrErrors) ? messageOrErrors : Array.isArray(errorsOrOptions) ? errorsOrOptions : [];
  }

  log(logger: ILogger): void {
    if (this.validationErrors.length === 0) return;
    const lines = [`There are ${this.validationErrors.length} validation errors:`];
    for (const result of this.validationErrors) {
      const memberNames = result.memberNames.length > 0 ? ` (${result.memberNames.join(", ")})` : "";
      lines.push(`${result.errorMessage}${memberNames}`);
    }
    logger.log(this.logLevel, lines.join("\n"));
  }
}

/** Port of `HasValidationErrorsExtensions.WithValidationError`. */
export function withValidationError<TException extends { readonly validationErrors: ValidationResult[] }>(exception: TException, validationError: ValidationResult): TException;
export function withValidationError<TException extends { readonly validationErrors: ValidationResult[] }>(exception: TException, errorMessage: string, ...memberNames: string[]): TException;
export function withValidationError<TException extends { readonly validationErrors: ValidationResult[] }>(exception: TException, error: ValidationResult | string, ...memberNames: string[]): TException {
  exception.validationErrors.push(typeof error === "string" ? createValidationResult(error, ...memberNames) : error);
  return exception;
}
