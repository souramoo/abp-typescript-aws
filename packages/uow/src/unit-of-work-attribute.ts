import { createClassMarker, createMethodMetadata, getMethodNames, type Class } from "@abp/core";
import type { AbpUnitOfWorkOptions, IsolationLevel } from "./options.js";

/** Port of the `IUnitOfWorkEnabled` marker interface: `@UnitOfWorkEnabled()` (inherited by subclasses). */
export const UnitOfWorkEnabled = createClassMarker("IUnitOfWorkEnabled");

/** Port of the `UnitOfWorkAttribute` properties. */
export interface UnitOfWorkAttributeOptions {
  /** Is this UOW transactional? Uses the default value if not supplied. */
  isTransactional?: boolean;
  /** Timeout of the UOW in milliseconds. */
  timeout?: number;
  isolationLevel?: IsolationLevel;
  /** Prevents starting a unit of work for the method (ignored if one is already started). Default: false. */
  isDisabled?: boolean;
}

/** Metadata store behind `@UnitOfWork(...)`; usable programmatically (`UnitOfWorkMetadata.set(Type, "method", {...})`). */
export const UnitOfWorkMetadata = createMethodMetadata<UnitOfWorkAttributeOptions>("UnitOfWork");

/**
 * Port of `[UnitOfWork(...)]`: marks a method (or every method of a class) as atomic. It has no effect
 * when a unit of work already exists (the ambient one is used).
 */
export function UnitOfWork(options: UnitOfWorkAttributeOptions = {}) {
  return (target: object, propertyKey?: string | symbol, _descriptor?: PropertyDescriptor): void => {
    if (propertyKey === undefined) UnitOfWorkMetadata.setForClass(target as Class, options);
    else UnitOfWorkMetadata(options)(target, propertyKey);
  };
}

/** Port of `UnitOfWorkAttribute.SetOptions`. */
export function applyUnitOfWorkAttribute(attribute: UnitOfWorkAttributeOptions, options: AbpUnitOfWorkOptions): void {
  if (attribute.isTransactional !== undefined) options.isTransactional = attribute.isTransactional;
  if (attribute.timeout !== undefined) options.timeout = attribute.timeout;
  if (attribute.isolationLevel !== undefined) options.isolationLevel = attribute.isolationLevel;
}

export interface UnitOfWorkMethodInfo {
  readonly isUnitOfWork: boolean;
  readonly attribute: UnitOfWorkAttributeOptions | undefined;
}

/** Port of `UnitOfWorkHelper`. */
export const UnitOfWorkHelper = {
  isUnitOfWorkType(implementationType: Class): boolean {
    if (UnitOfWorkMetadata.getForClass(implementationType) !== undefined) return true;
    if (getMethodNames(implementationType).some((m) => UnitOfWorkMetadata.get(implementationType, m) !== undefined)) return true;
    return UnitOfWorkEnabled.has(implementationType);
  },

  isUnitOfWorkMethod(type: Class, method: string): UnitOfWorkMethodInfo {
    const methodAttribute = UnitOfWorkMetadata.get(type, method);
    if (methodAttribute) return { isUnitOfWork: !methodAttribute.isDisabled, attribute: methodAttribute };

    const classAttribute = UnitOfWorkMetadata.getForClass(type);
    if (classAttribute) return { isUnitOfWork: !classAttribute.isDisabled, attribute: classAttribute };

    if (UnitOfWorkEnabled.has(type)) return { isUnitOfWork: true, attribute: undefined };
    return { isUnitOfWork: false, attribute: undefined };
  },

  getUnitOfWorkAttributeOrNull(type: Class, method: string): UnitOfWorkAttributeOptions | undefined {
    return UnitOfWorkMetadata.get(type, method) ?? UnitOfWorkMetadata.getForClass(type);
  },
};
