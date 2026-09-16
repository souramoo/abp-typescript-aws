import { Transient, createToken, type Class } from "@abp/core";
import { IJsonSerializer, type JsonSchema } from "@abp/json";

export type JobArgsTarget<T> = Class<T & object> | JsonSchema<T>;

/** Port of `IBackgroundJobSerializer`. */
export interface IBackgroundJobSerializer {
  serialize(obj: unknown): string;
  deserialize<T>(value: string, type: JobArgsTarget<T>): T;
}
export const IBackgroundJobSerializer = createToken<IBackgroundJobSerializer>("IBackgroundJobSerializer");

/**
 * Port of `JsonBackgroundJobSerializer`. Without runtime generics, an args class is revived by assigning the parsed
 * JSON onto an instance created from its prototype; a `static schema` (zod) on the class is used when present.
 */
@Transient(IBackgroundJobSerializer)
export class JsonBackgroundJobSerializer implements IBackgroundJobSerializer {
  static readonly inject = [IJsonSerializer] as const;

  constructor(private readonly jsonSerializer: IJsonSerializer) {}

  serialize(obj: unknown): string {
    return this.jsonSerializer.serialize(obj);
  }

  deserialize<T>(value: string, type: JobArgsTarget<T>): T {
    if (hasSchema(type)) return this.jsonSerializer.deserialize(value, type);
    if (typeof type === "function") {
      const parsed = this.jsonSerializer.deserialize(value);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return parsed as T;
      return Object.assign(Object.create(type.prototype as object) as T & object, parsed);
    }
    return this.jsonSerializer.deserialize(value, type);
  }
}

function hasSchema<T>(type: JobArgsTarget<T>): type is { readonly schema: { parse(input: unknown): T } } {
  return "schema" in type && typeof (type as { schema?: { parse?: unknown } }).schema?.parse === "function";
}
