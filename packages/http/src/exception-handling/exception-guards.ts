import type { Class, IServiceProvider, IStringLocalizerFactory } from "@abp/core";
import { AbpAuthorizationException } from "@abp/security";
import { AbpValidationException } from "@abp/validation";
import { isBusinessException } from "@abp/core";

/**
 * Shape of `Volo.Abp.Domain.Entities.EntityNotFoundException`. `@abp/ddd-domain` is not a dependency of this
 * package, so the exception is recognised by its class name (`AbpException` sets `name` to the class name).
 */
export interface EntityNotFoundLike extends Error {
  readonly entityType?: Class | string;
  readonly id?: unknown;
}

function hasConstructorNamed(value: unknown, className: string): boolean {
  if (!(value instanceof Error)) return false;
  let proto: unknown = Object.getPrototypeOf(value);
  while (proto && proto !== Error.prototype && proto !== Object.prototype) {
    const ctor = (proto as { constructor?: { name?: string } }).constructor;
    if (ctor?.name === className) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

export function isEntityNotFoundException(value: unknown): value is EntityNotFoundLike {
  return hasConstructorNamed(value, "EntityNotFoundException");
}

/** Port of `AggregateException` unwrapping for `AggregateError`. */
export function isAggregateError(value: unknown): value is AggregateError {
  return value instanceof AggregateError;
}

export function entityTypeName(exception: EntityNotFoundLike): string | undefined {
  const type = exception.entityType;
  if (type === undefined) return undefined;
  return typeof type === "string" ? type : type.name;
}

/** Port of `LocalizationContext` (given to `ILocalizeErrorMessage.LocalizeMessage`). */
export class LocalizationContext {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly localizerFactory: IStringLocalizerFactory,
  ) {}
}

/** Port of `ILocalizeErrorMessage`: exceptions that localize their own message. */
export interface ILocalizeErrorMessage {
  localizeMessage(context: LocalizationContext): string;
}

export function isLocalizeErrorMessage(value: unknown): value is Error & ILocalizeErrorMessage {
  return value instanceof Error && typeof (value as unknown as ILocalizeErrorMessage).localizeMessage === "function";
}

/** The exception kinds `TryToGetActualException` unwraps from an aggregate. */
export function isUnwrappableInnerException(value: unknown): boolean {
  return value instanceof AbpValidationException || value instanceof AbpAuthorizationException || isEntityNotFoundException(value) || isBusinessException(value);
}

/** Port of `Exception.Data` access: a plain-object `data` bag on the exception (BusinessException, AbpAuthorizationException). */
export function exceptionDataOf(exception: unknown): Record<string, unknown> | undefined {
  const data = (exception as { data?: unknown } | null)?.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  return data as Record<string, unknown>;
}
