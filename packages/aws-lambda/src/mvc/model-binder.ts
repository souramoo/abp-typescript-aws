import { AbpException, Guid, type Class, type ValidationResult } from "@abp/core";
import { AbpValidationException, createValidationResult, zodIssuesToValidationResults } from "@abp/validation";
import { z } from "zod";
import type { AbpHttpContext } from "../http-context.js";
import type { ParameterBinding, PrimitiveBindingType, SchemaSource } from "./controller.js";

/** Port of `ModelStateDictionary` reduced to what the API needs: the binding/validation errors of one request. */
export class ModelState {
  readonly errors: ValidationResult[] = [];

  addError(key: string, message: string): void {
    this.errors.push(createValidationResult(message, ...(key ? [key] : [])));
  }

  get isValid(): boolean {
    return this.errors.length === 0;
  }
}

/** Port of `IModelStateValidator` / `ModelStateValidator`. */
export const ModelStateValidator = {
  validate(modelState: ModelState): void {
    if (modelState.isValid) return;
    throw new AbpValidationException("ModelState is not valid! See validationErrors for details.", [...modelState.errors]);
  },
};

interface ResolvedSchema {
  readonly schema: z.ZodType | undefined;
  readonly type: Class | undefined;
}

function resolveSchema(source: SchemaSource | undefined): ResolvedSchema {
  if (source === undefined) return { schema: undefined, type: undefined };
  if (source instanceof z.ZodType) return { schema: source, type: undefined };
  const candidate = (source as { schema?: unknown }).schema;
  return { schema: candidate instanceof z.ZodType ? candidate : undefined, type: source };
}

/** The scalar kind a zod schema expects at its top level (unwrapping optional/nullable/default/pipe/readonly/catch). */
function expectedKind(schema: z.ZodType): "number" | "boolean" | "date" | "array" | "bigint" | "other" {
  let current: unknown = schema;
  for (let depth = 0; depth < 16 && current; depth++) {
    const def = (current as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (!def) return "other";
    const type = def["type"];
    switch (type) {
      case "number":
      case "int":
        return "number";
      case "boolean":
        return "boolean";
      case "date":
        return "date";
      case "bigint":
        return "bigint";
      case "array":
        return "array";
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "readonly":
      case "catch":
      case "nonoptional":
        current = def["innerType"];
        continue;
      case "pipe":
        current = def["in"];
        continue;
      default:
        return "other";
    }
  }
  return "other";
}

function arrayElement(schema: z.ZodType): z.ZodType | undefined {
  let current: unknown = schema;
  for (let depth = 0; depth < 16 && current; depth++) {
    const def = (current as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (!def) return undefined;
    if (def["type"] === "array") return def["element"] as z.ZodType;
    if (def["type"] === "pipe") current = def["in"];
    else current = def["innerType"];
  }
  return undefined;
}

function objectShape(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  let current: unknown = schema;
  for (let depth = 0; depth < 16 && current; depth++) {
    const def = (current as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (!def) return undefined;
    if (def["type"] === "object") return def["shape"] as Record<string, z.ZodType>;
    if (def["type"] === "pipe") current = def["in"];
    else current = def["innerType"];
  }
  return undefined;
}

/** Converts one string the way the target zod schema expects (query/route/form values are always strings). */
function coerceScalar(value: string, schema: z.ZodType | undefined): unknown {
  if (!schema) return value;
  switch (expectedKind(schema)) {
    case "number": {
      const trimmed = value.trim();
      const number = trimmed === "" ? Number.NaN : Number(trimmed);
      return Number.isFinite(number) ? number : value;
    }
    case "boolean":
      return toBoolean(value) ?? value;
    case "date": {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date;
    }
    case "bigint":
      return /^-?\d+$/.test(value.trim()) ? BigInt(value.trim()) : value;
    default:
      return value;
  }
}

function toBoolean(value: string): boolean | undefined {
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "on") return true;
  if (lower === "false" || lower === "0" || lower === "off") return false;
  return undefined;
}

function convertPrimitive(value: string, type: PrimitiveBindingType, key: string, modelState: ModelState): unknown {
  switch (type) {
    case "string":
      return value;
    case "number": {
      const number = value.trim() === "" ? Number.NaN : Number(value);
      if (Number.isFinite(number)) return number;
      modelState.addError(key, `The value '${value}' is not valid for ${key}.`);
      return undefined;
    }
    case "boolean": {
      const bool = toBoolean(value);
      if (bool !== undefined) return bool;
      modelState.addError(key, `The value '${value}' is not valid for ${key}.`);
      return undefined;
    }
    case "guid":
      if (Guid.isValid(value)) return Guid.parse(value);
      modelState.addError(key, `The value '${value}' is not valid for ${key}.`);
      return undefined;
    case "date": {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
      modelState.addError(key, `The value '${value}' is not valid for ${key}.`);
      return undefined;
    }
    default: {
      const _exhaustive: never = type;
      throw new AbpException(`Unknown binding type ${String(_exhaustive)}`);
    }
  }
}

/** `URLSearchParams` → plain object; repeated keys become arrays (also when the schema expects an array). */
function paramsToObject(params: URLSearchParams, schema: z.ZodType | undefined): Record<string, unknown> {
  const shape = schema ? objectShape(schema) : undefined;
  const result: Record<string, unknown> = {};
  const keys = new Set(params.keys());
  for (const key of keys) {
    const values = params.getAll(key);
    const propertySchema = shape?.[key] ?? findCaseInsensitive(shape, key);
    const targetKey = shape && propertySchema ? (Object.keys(shape).find((k) => k === key || k.toLowerCase() === key.toLowerCase()) ?? key) : key;
    if (propertySchema && expectedKind(propertySchema) === "array") {
      const element = arrayElement(propertySchema);
      result[targetKey] = values.map((v) => coerceScalar(v, element));
      continue;
    }
    result[targetKey] = values.length > 1 ? values.map((v) => coerceScalar(v, propertySchema)) : coerceScalar(values[0]!, propertySchema);
  }
  return result;
}

function findCaseInsensitive(shape: Record<string, z.ZodType> | undefined, key: string): z.ZodType | undefined {
  if (!shape) return undefined;
  const lower = key.toLowerCase();
  for (const [name, schema] of Object.entries(shape)) if (name.toLowerCase() === lower) return schema;
  return undefined;
}

/** Validates with the schema (if any) and materialises a DTO instance when the binding names a class. */
function materialize(raw: unknown, resolved: ResolvedSchema, memberPrefix: string, modelState: ModelState): unknown {
  let value = raw;
  if (resolved.schema) {
    const result = resolved.schema.safeParse(raw);
    if (!result.success) {
      for (const error of zodIssuesToValidationResults(result.error.issues, raw, memberPrefix)) modelState.errors.push(error);
      return undefined;
    }
    value = result.data;
  }
  if (resolved.type && typeof value === "object" && value !== null && !(value instanceof resolved.type)) {
    return Object.assign(new resolved.type(), value);
  }
  return value;
}

/**
 * Port of the MVC model binding for the explicit bindings of an action: fills the argument list from route values,
 * query string, headers, JSON/form body, the context or services; binding/validation problems land in `ModelState`.
 */
export function bindParameters(context: AbpHttpContext, bindings: readonly ParameterBinding[], modelState: ModelState): unknown[] {
  return bindings.map((binding) => bindParameter(context, binding, modelState));
}

function bindParameter(context: AbpHttpContext, binding: ParameterBinding, modelState: ModelState): unknown {
  const request = context.request;
  switch (binding.source) {
    case "route":
    case "query":
    case "header": {
      const raw = binding.source === "route" ? request.routeValues[binding.name] : binding.source === "query" ? (request.query.get(binding.name) ?? undefined) : request.headers.get(binding.name);
      if (raw === undefined) {
        if (!binding.optional) modelState.addError(binding.name, `The ${binding.name} field is required.`);
        return undefined;
      }
      const converted = convertPrimitive(raw, binding.type, binding.name, modelState);
      if (converted === undefined || !binding.schema) return converted;
      const result = binding.schema.safeParse(converted);
      if (result.success) return result.data;
      for (const error of zodIssuesToValidationResults(result.error.issues, converted, binding.name)) modelState.errors.push(error);
      return undefined;
    }
    case "queryObject": {
      const resolved = resolveSchema(binding.dto);
      return materialize(paramsToObject(request.query, resolved.schema), resolved, "", modelState);
    }
    case "form": {
      const resolved = resolveSchema(binding.dto);
      return materialize(paramsToObject(request.form(), resolved.schema), resolved, "", modelState);
    }
    case "body": {
      const resolved = resolveSchema(binding.dto);
      if (!request.hasBody) {
        if (!binding.optional) modelState.addError("", "A non-empty request body is required.");
        return undefined;
      }
      let raw: unknown;
      try {
        raw = request.hasFormContentType ? paramsToObject(request.form(), resolved.schema) : context.jsonSerializer.deserialize(request.body ?? "");
      } catch (e) {
        modelState.addError("$", `The request body could not be parsed: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      }
      return materialize(raw, resolved, "", modelState);
    }
    case "context":
      return context;
    case "services":
      return context.serviceProvider.getRequired(binding.key);
    default: {
      const _exhaustive: never = binding;
      throw new AbpException(`Unknown binding ${String(_exhaustive)}`);
    }
  }
}
