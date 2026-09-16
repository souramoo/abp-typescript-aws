import { LogLevel, type IHasLogLevel } from "../logging/logger.js";

export class AbpException extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AbpInitializationException extends AbpException {}
export class AbpShutdownException extends AbpException {}

/** Port of `IHasErrorCode` / `IHasErrorDetails` / `IHasHttpStatusCode`. */
export interface IHasErrorCode {
  code: string | undefined;
}
export interface IHasErrorDetails {
  details: string | undefined;
}
export interface IHasHttpStatusCode {
  httpStatusCode: number;
}
export interface IHasValidationErrors {
  validationErrors: readonly ValidationResult[];
}
export interface ValidationResult {
  errorMessage: string;
  memberNames: readonly string[];
}
export interface IBusinessException {
  readonly isBusinessException: true;
}
export interface IUserFriendlyException extends IBusinessException {
  readonly isUserFriendlyException: true;
}

export function hasErrorCode(value: unknown): value is IHasErrorCode {
  return typeof value === "object" && value !== null && "code" in value;
}
export function hasErrorDetails(value: unknown): value is IHasErrorDetails {
  return typeof value === "object" && value !== null && "details" in value;
}
export function hasHttpStatusCode(value: unknown): value is IHasHttpStatusCode {
  return typeof value === "object" && value !== null && typeof (value as IHasHttpStatusCode).httpStatusCode === "number";
}
export function hasValidationErrors(value: unknown): value is IHasValidationErrors {
  return typeof value === "object" && value !== null && Array.isArray((value as IHasValidationErrors).validationErrors);
}
export function isBusinessException(value: unknown): value is Error & IBusinessException {
  return value instanceof Error && (value as unknown as IBusinessException).isBusinessException === true;
}
export function isUserFriendlyException(value: unknown): value is Error & IUserFriendlyException {
  return value instanceof Error && (value as unknown as IUserFriendlyException).isUserFriendlyException === true;
}

export interface BusinessExceptionInit {
  code?: string;
  message?: string;
  details?: string;
  cause?: unknown;
  logLevel?: LogLevel;
}

/**
 * Port of `BusinessException`. `code` is looked up in localization resources by the exception
 * handling layer (`"ResourceName:ErrorCode"`), `data` fills `{PlaceHolder}`s of the localized text.
 */
export class BusinessException extends AbpException implements IBusinessException, IHasErrorCode, IHasErrorDetails, IHasLogLevel {
  readonly isBusinessException = true as const;
  code: string | undefined;
  details: string | undefined;
  logLevel: LogLevel;
  readonly data: Record<string, unknown> = {};

  constructor(init: BusinessExceptionInit = {}) {
    super(init.message ?? init.code ?? "Business exception", { cause: init.cause });
    this.code = init.code;
    this.details = init.details;
    this.logLevel = init.logLevel ?? LogLevel.Warning;
  }

  withData(name: string, value: unknown): this {
    this.data[name] = value;
    return this;
  }
}

/** Port of `UserFriendlyException`: message is safe to show to end users as-is. */
export class UserFriendlyException extends BusinessException implements IUserFriendlyException {
  readonly isUserFriendlyException = true as const;
  constructor(message: string, init: Omit<BusinessExceptionInit, "message"> = {}) {
    super({ ...init, message });
  }
}
