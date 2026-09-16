import { createToken } from "@abp/core";

export interface JsonSerializeOptions {
  /** Default: `AbpJsonOptions.camelCase` (true). Renames properties of class instances; plain objects and Maps keep their keys. */
  camelCase?: boolean;
  indented?: boolean;
}

/** Anything with a zod-like `parse`; a DTO class exposing `static schema` also qualifies. */
export interface JsonParser<T> {
  parse(input: unknown): T;
}
export type JsonSchema<T> = JsonParser<T> | { readonly schema: JsonParser<T> };

/**
 * Port of `IJsonSerializer`. `Deserialize<T>` needs a runtime type, so it takes an optional parser/schema;
 * without one it returns the untyped JSON value.
 */
export interface IJsonSerializer {
  serialize(obj: unknown, options?: JsonSerializeOptions): string;
  deserialize(jsonString: string): unknown;
  deserialize<T>(jsonString: string, schema: JsonSchema<T>): T;
}
export const IJsonSerializer = createToken<IJsonSerializer>("IJsonSerializer");
