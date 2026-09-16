import { isBusinessException, type Class } from "@abp/core";

/** A class (`instanceof`) or a predicate; the port of the `List<Type>` selectors of the .NET options. */
export type ExceptionSelector = Class | ((exception: unknown) => boolean);

export function matchesExceptionSelector(selector: ExceptionSelector, exception: unknown): boolean {
  if (isConstructor(selector)) return exception instanceof selector;
  return (selector as (exception: unknown) => boolean)(exception);
}

function isConstructor(value: ExceptionSelector): value is Class {
  return typeof value === "function" && value.prototype !== undefined && /^class\s/.test(Function.prototype.toString.call(value));
}

/**
 * Port of `Volo.Abp.AspNetCore.ExceptionHandling.AbpExceptionHandlingOptions` (client-facing error details).
 * The core `AbpExceptionHandlingOptions` (`@abp/core`) is the `Volo.Abp.ExceptionHandling` one with the subscribers.
 */
export class AbpExceptionHandlingOptions {
  sendExceptionsDetailsToClients = false;
  sendStackTraceToClients = true;
  /** Exceptions whose `data` is sent to clients (`typeof(IBusinessException)` in .NET). */
  sendExceptionDataToClientTypes: ExceptionSelector[] = [isBusinessException];
  /** Selectors to exclude exceptions from logging: if any returns true the exception is not logged. */
  readonly excludeExceptionFromLoggerSelectors: ((exception: unknown) => boolean)[] = [];

  shouldLogException(exception: unknown): boolean {
    return this.excludeExceptionFromLoggerSelectors.every((selector) => !selector(exception));
  }
}

/** Port of `AbpExceptionHttpStatusCodeOptions`. */
export class AbpExceptionHttpStatusCodeOptions {
  readonly errorCodeToHttpStatusCodeMappings = new Map<string, number>();

  map(errorCode: string, httpStatusCode: number): void {
    this.errorCodeToHttpStatusCodeMappings.set(errorCode, httpStatusCode);
  }
}

/** Port of `AbpExceptionHandlingConsts`. */
export const AbpExceptionHandlingConsts = {
  Unauthorized: "Unauthorized",
  InvalidToken: "invalid_token",
  SessionExpired: "SessionExpired",
} as const;
