import { Transient, createToken, type Class } from "@abp/core";
import { IJsonSerializer, type JsonSchema } from "@abp/json";
import type { CacheValue } from "./distributed-cache-store.js";

/** Runtime stand-in for `Deserialize<T>`: a class (optionally with a `static schema`) or a zod-like parser. */
export type DeserializationTarget<T> = Class<T & object> | JsonSchema<T>;

/** Port of `IDistributedCacheSerializer`. */
export interface IDistributedCacheSerializer {
  serialize(obj: unknown): Uint8Array;
  deserialize<T>(value: CacheValue, type?: DeserializationTarget<T>): T;
}
export const IDistributedCacheSerializer = createToken<IDistributedCacheSerializer>("IDistributedCacheSerializer");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Port of `Utf8JsonDistributedCacheSerializer`. Without runtime generics, a plain class target is revived by
 * assigning the parsed JSON onto an instance created from its prototype; a `static schema` (zod) is used when present.
 */
@Transient(IDistributedCacheSerializer)
export class Utf8JsonDistributedCacheSerializer implements IDistributedCacheSerializer {
  static readonly inject = [IJsonSerializer] as const;

  constructor(protected readonly jsonSerializer: IJsonSerializer) {}

  serialize(obj: unknown): Uint8Array {
    return encoder.encode(this.jsonSerializer.serialize(obj));
  }

  deserialize<T>(value: CacheValue, type?: DeserializationTarget<T>): T {
    const json = typeof value === "string" ? value : decoder.decode(value);
    return deserializeJsonAs(this.jsonSerializer, json, type);
  }
}

export function deserializeJsonAs<T>(jsonSerializer: IJsonSerializer, json: string, type: DeserializationTarget<T> | undefined): T {
  if (type === undefined) return jsonSerializer.deserialize(json) as T;
  if (hasSchema(type)) return jsonSerializer.deserialize(json, type);
  if (typeof type === "function") {
    const parsed = jsonSerializer.deserialize(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return parsed as T;
    return Object.assign(Object.create(type.prototype as object) as T & object, parsed);
  }
  return jsonSerializer.deserialize(json, type);
}

function hasSchema<T>(type: DeserializationTarget<T>): type is { readonly schema: { parse(input: unknown): T } } {
  return "schema" in type && typeof (type as { schema?: { parse?: unknown } }).schema?.parse === "function";
}
