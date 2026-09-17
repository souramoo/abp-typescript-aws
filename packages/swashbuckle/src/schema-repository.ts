import type { Class } from "@abp/core";
import { z } from "zod";
import { isNamedSchema, schemaOfSource, type ResponseSchemaSource } from "./api-explorer.js";
import type { OpenApiSchema } from "./openapi-types.js";

/** `input` describes what a client sends (defaults optional), `output` what the API returns. */
export type SchemaIo = "input" | "output";

type OverrideContext = Parameters<NonNullable<z.core.JSONSchemaGeneratorParams["override"]>>[0];

const definitionsPrefix = "#/definitions/";
export const componentsPrefix = "#/components/schemas/";

/**
 * Port of Swashbuckle's `SchemaRepository` + `ISchemaGenerator` over zod: DTO classes (`static schema`) and named
 * schemas become `components.schemas` entries referenced by `$ref`; bare zod schemas are inlined. Nested DTO
 * schemas are recognised by identity, so `declare()` every source first, then `getOrAdd()` while emitting operations.
 * Enum schemas get `x-enumNames` (port of `AbpSwashbuckleEnumSchemaFilter`), dates become `string`/`date-time`.
 */
export class SchemaRepository {
  readonly schemas: Record<string, OpenApiSchema> = {};
  private readonly names = new WeakMap<z.core.$ZodType, string>();
  private readonly declared = new Map<string, z.ZodType | undefined>();

  constructor(private readonly schemaIdSelector: (type: Class) => string = (type) => type.name) {}

  /** Reserves the component name of a class or named schema (and of the DTOs it references) without converting it. */
  declare(source: ResponseSchemaSource | undefined): void {
    if (source === undefined || source instanceof z.ZodType) return;
    if (isNamedSchema(source)) {
      for (const reference of source.references ?? []) this.declare(reference);
      this.declareNamed(source.name, source.schema);
      return;
    }
    this.declareNamed(this.schemaIdSelector(source), schemaOfSource(source));
  }

  /** A `$ref` to the component of a class/named schema (added on first use), or the inline schema of a bare zod schema. */
  getOrAdd(source: ResponseSchemaSource | undefined, io: SchemaIo): OpenApiSchema {
    if (source === undefined) return {};
    if (source instanceof z.ZodType) return this.convert(source, io);
    this.declare(source);
    const name = isNamedSchema(source) ? source.name : this.schemaIdSelector(source);
    this.ensure(name, io);
    return { $ref: `${componentsPrefix}${name}` };
  }

  /** Adds a hand-written component (the ABP error models). */
  add(name: string, schema: OpenApiSchema): void {
    this.schemas[name] ??= schema;
  }

  convert(schema: z.ZodType, io: SchemaIo): OpenApiSchema {
    const json = z.toJSONSchema(schema, {
      target: "openapi-3.0",
      io,
      unrepresentable: "any",
      cycles: "ref",
      reused: "inline",
      override: (context) => this.override(context, io),
    });
    return this.relocateDefinitions(json as Record<string, unknown>);
  }

  private ensure(name: string, io: SchemaIo): void {
    if (name in this.schemas) return;
    const schema = this.declared.get(name);
    this.schemas[name] = { type: "object" };
    this.schemas[name] = schema ? this.convert(schema, io) : { type: "object", properties: {} };
  }

  private declareNamed(name: string, schema: z.ZodType | undefined): void {
    if (!this.declared.has(name)) this.declared.set(name, schema);
    if (schema && !this.names.has(schema)) this.names.set(schema, name);
  }

  private override(context: OverrideContext, io: SchemaIo): void {
    const target = context.jsonSchema as Record<string, unknown>;
    const named = this.names.get(context.zodSchema);
    if (named !== undefined && context.path.length > 0) {
      this.ensure(named, io);
      for (const key of Object.keys(target)) delete target[key];
      target["$ref"] = `${componentsPrefix}${named}`;
      return;
    }
    const def = context.zodSchema._zod.def;
    switch (def.type) {
      case "date":
        target["type"] = "string";
        target["format"] = "date-time";
        return;
      case "enum": {
        const values = target["enum"];
        if (Array.isArray(values)) target["x-enumNames"] = enumNames(def.entries, values);
        return;
      }
      default:
        return;
    }
  }

  /** zod extracts `meta({ id })` schemas into `definitions`; OpenAPI keeps them in `components.schemas`. */
  private relocateDefinitions(json: Record<string, unknown>): OpenApiSchema {
    const { definitions, ...rest } = json;
    if (typeof definitions === "object" && definitions !== null) {
      for (const [name, definition] of Object.entries(definitions as Record<string, unknown>)) {
        this.schemas[name] ??= rewriteReferences(definition) as OpenApiSchema;
      }
    }
    return rewriteReferences(rest) as OpenApiSchema;
  }
}

/** Numeric TS enums carry reverse mappings in `entries`; the names are the non-numeric keys, in `enum` value order. */
function enumNames(entries: Record<string, string | number>, values: readonly unknown[]): string[] {
  return values.map((value) => Object.keys(entries).find((key) => entries[key] === value && !/^\d+$/.test(key)) ?? String(value));
}

function rewriteReferences(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteReferences);
  if (typeof node !== "object" || node === null) return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    result[key] = key === "$ref" && typeof value === "string" && value.startsWith(definitionsPrefix) ? `${componentsPrefix}${value.slice(definitionsPrefix.length)}` : rewriteReferences(value);
  }
  return result;
}
