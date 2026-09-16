import { IServiceProviderToken, optionsToken, Transient, type Class, type IOptions, type IServiceProvider, type ValidationResult } from "@abp/core";
import { z } from "zod";
import { AbpValidationOptions } from "./abp-validation-options.js";
import type { IObjectValidationContributor, ObjectValidationContext } from "./object-validation-contributor.js";
import { ValidationMetadata } from "./validation-attributes.js";
import { ValidationContext, isValidatableObject } from "./validation-context.js";
import { createValidationResult } from "./validation-result.js";

/** A class that carries its zod schema: `static readonly schema = z.object({...})`. */
export interface HasSchema {
  readonly schema: z.ZodType;
}

export function schemaOf(value: object): z.ZodType | undefined {
  const type: unknown = value.constructor;
  if (typeof type !== "function" || !("schema" in type)) return undefined;
  const schema: unknown = type.schema;
  return schema instanceof z.ZodType ? schema : undefined;
}

/** Port of `TypeHelper.IsPrimitiveExtended` for runtime values. */
export function isPrimitiveExtended(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function") || value instanceof Date;
}

/** Maps zod issues to DataAnnotations-style results; a missing (null/undefined) value gets the `[Required]` message. */
export function zodIssuesToValidationResults(issues: readonly z.core.$ZodIssue[], validatedValue: unknown, memberPrefix?: string): ValidationResult[] {
  return issues.map((issue) => {
    const path = issue.path.map(String);
    const member = [memberPrefix, ...path].filter((p): p is string => p !== undefined && p !== "").join(".");
    const input = valueAt(validatedValue, issue.path);
    const message = issue.code === "invalid_type" && (input === undefined || input === null) ? `The ${member || "value"} field is required.` : issue.message;
    return createValidationResult(message, ...(member ? [member] : []));
  });
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/**
 * Port of `DataAnnotationObjectValidationContributor`: validates an object against its class' static zod
 * `schema`, calls `IValidatableObject.validate`, and recurses into properties and iterables.
 */
@Transient()
export class ZodObjectValidationContributor implements IObjectValidationContributor {
  static readonly inject = [optionsToken(AbpValidationOptions), IServiceProviderToken] as const;
  static readonly maxRecursiveParameterValidationDepth = 8;
  protected readonly options: AbpValidationOptions;

  constructor(
    options: IOptions<AbpValidationOptions>,
    protected readonly serviceProvider: IServiceProvider | undefined,
  ) {
    this.options = options.value;
  }

  async addErrorsAsync(context: ObjectValidationContext): Promise<void> {
    const errors: ValidationResult[] = [];
    await this.validateObjectRecursively(errors, context.validatingObject, 1);
    for (const error of distinctResults(errors)) context.errors.push(error);
  }

  protected async validateObjectRecursively(errors: ValidationResult[], validatingObject: unknown, currentDepth: number): Promise<void> {
    if (currentDepth > ZodObjectValidationContributor.maxRecursiveParameterValidationDepth) return;
    if (validatingObject === null || validatingObject === undefined || isPrimitiveExtended(validatingObject)) return;
    if (typeof validatingObject !== "object") return;

    await this.addErrors(errors, validatingObject);

    if (isIterable(validatingObject)) {
      for (const item of validatingObject) {
        if (item === null || item === undefined || isPrimitiveExtended(item)) break;
        await this.validateObjectRecursively(errors, item, currentDepth + 1);
      }
      return;
    }

    if (this.options.ignoredTypes.some((t) => validatingObject instanceof t)) return;

    const type = validatingObject.constructor as Class | undefined;
    for (const [name, value] of Object.entries(validatingObject)) {
      if (ValidationMetadata.isDisabledForProperty(type, name)) continue;
      await this.validateObjectRecursively(errors, value, currentDepth + 1);
    }
  }

  async addErrors(errors: ValidationResult[], validatingObject: object): Promise<void> {
    const schema = schemaOf(validatingObject);
    if (schema) {
      const result = schema.safeParse(validatingObject);
      if (!result.success) errors.push(...zodIssuesToValidationResults(result.error.issues, validatingObject));
    }
    if (isValidatableObject(validatingObject)) {
      errors.push(...(await validatingObject.validate(new ValidationContext(validatingObject, this.serviceProvider))));
    }
  }
}

function isIterable(value: object): value is Iterable<unknown> {
  return Symbol.iterator in value && typeof value[Symbol.iterator] === "function";
}

function distinctResults(results: readonly ValidationResult[]): ValidationResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = JSON.stringify([r.memberNames, r.errorMessage]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
