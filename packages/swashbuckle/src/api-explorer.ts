import { createMethodMetadata, type Class } from "@abp/core";
import type { SchemaSource } from "@abp/aws-lambda";
import { z } from "zod";

/**
 * A zod schema published under an explicit component name (port of a closed generic such as `PagedResultDto<BookDto>`,
 * whose Swashbuckle schema id is `PagedResultDtoOfBookDto`). `references` lists the DTO classes the schema embeds so
 * they become `$ref`s instead of inline copies.
 */
export interface NamedSchema {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly references?: readonly ResponseSchemaSource[];
}

export type ResponseSchemaSource = SchemaSource | NamedSchema;

export function isNamedSchema(value: unknown): value is NamedSchema {
  return typeof value === "object" && value !== null && typeof (value as NamedSchema).name === "string" && (value as NamedSchema).schema instanceof z.ZodType;
}

/** The zod schema a source carries: a DTO class's `static schema`, a named schema's schema or the bare schema. */
export function schemaOfSource(source: ResponseSchemaSource | undefined): z.ZodType | undefined {
  if (source === undefined) return undefined;
  if (source instanceof z.ZodType) return source;
  if (isNamedSchema(source)) return source.schema;
  const candidate: unknown = (source as { schema?: unknown }).schema;
  return candidate instanceof z.ZodType ? candidate : undefined;
}

/** The component name of a source; bare zod schemas are named by their `meta({ id })` only. */
export function nameOfSource(source: ResponseSchemaSource | undefined): string | undefined {
  if (source === undefined) return undefined;
  if (source instanceof z.ZodType) {
    const id: unknown = source.meta()?.id;
    return typeof id === "string" ? id : undefined;
  }
  if (isNamedSchema(source)) return source.name;
  return (source as Class).name;
}

/** Port of `[ProducesResponseType(typeof(T), statusCode)]`: one declared response of an action. */
export interface ProducesResponseType {
  readonly statusCode: number;
  /** `undefined` describes a response without a body (`ProducesNoContent`). */
  readonly source: ResponseSchemaSource | undefined;
  readonly contentType: string;
}

const producesMetadata = createMethodMetadata<readonly ProducesResponseType[]>("ProducesResponseType");

type MethodDecorator = (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => void;

function addProduces(response: ProducesResponseType): MethodDecorator {
  return (target, propertyKey) => {
    const type = (target as { constructor: Class }).constructor;
    producesMetadata([...(producesMetadata.get(type, String(propertyKey)) ?? []), response])(target, propertyKey);
  };
}

/**
 * Declares the response body of an action for the OpenAPI document (port of `[ProducesResponseType(typeof(T), 200)]`).
 * TypeScript keeps no return types at runtime, so without it the document shows an empty `200` schema.
 * `@Produces(BookDto)`, `@Produces(pagedResultOf(BookDto))`, `@Produces(z.array(z.string()), { statusCode: 201 })`.
 */
export function Produces(source: ResponseSchemaSource, options: { statusCode?: number; contentType?: string } = {}): MethodDecorator {
  return addProduces({ statusCode: options.statusCode ?? 200, source, contentType: options.contentType ?? "application/json" });
}

/** Port of `[ProducesResponseType(StatusCodes.Status204NoContent)]` for `void` actions. */
export function ProducesNoContent(statusCode = 204): MethodDecorator {
  return addProduces({ statusCode, source: undefined, contentType: "" });
}

export const ProducesMetadata = {
  get(type: Class | undefined, method: string): readonly ProducesResponseType[] {
    return producesMetadata.get(type, method) ?? [];
  },
};

/** Port of `[ApiExplorerSettings(IgnoreApi = true, GroupName = "...")]` on a controller. */
export interface ApiExplorerSettingsOptions {
  ignoreApi?: boolean;
  groupName?: string;
}

const apiExplorerMetadata = createMethodMetadata<ApiExplorerSettingsOptions>("ApiExplorerSettings");

export function ApiExplorerSettings(options: ApiExplorerSettingsOptions) {
  return (target: Class): void => {
    apiExplorerMetadata.setForClass(target, options);
  };
}

export const ApiExplorerMetadata = {
  get(type: Class | undefined): ApiExplorerSettingsOptions | undefined {
    return apiExplorerMetadata.getForClass(type);
  },
  isIgnored(type: Class | undefined): boolean {
    return apiExplorerMetadata.getForClass(type)?.ignoreApi === true;
  },
};

function itemSchema(item: ResponseSchemaSource): z.ZodType {
  return schemaOfSource(item) ?? z.looseObject({});
}

/** `ListResultDto<T>` as a named schema (`ListResultDtoOf<T>`, ABP's `CustomAbpSchemaIds` convention). */
export function listResultOf(item: ResponseSchemaSource): NamedSchema {
  const name = nameOfSource(item) ?? "Object";
  return { name: `ListResultDtoOf${name}`, schema: z.object({ items: z.array(itemSchema(item)) }), references: [item] };
}

/** `PagedResultDto<T>` as a named schema (`PagedResultDtoOf<T>`). */
export function pagedResultOf(item: ResponseSchemaSource): NamedSchema {
  const name = nameOfSource(item) ?? "Object";
  return { name: `PagedResultDtoOf${name}`, schema: z.object({ totalCount: z.number().int(), items: z.array(itemSchema(item)) }), references: [item] };
}
