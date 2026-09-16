import type { Class } from "@abp/core";

/** Port of `JsonConverter<T>.Write`: replaces a value with its JSON-ready form before `JSON.stringify`. */
export interface IJsonOutputConverter {
  canWrite(value: unknown): boolean;
  write(value: unknown): unknown;
}

/** Port of `JsonConverter<T>.Read`: replaces a parsed JSON value (reviver) with its runtime form. */
export interface IJsonInputConverter {
  canRead(value: unknown): boolean;
  read(value: unknown): unknown;
}

/** A converter instance, or a class resolved from the container (for converters with dependencies). */
export type JsonConverterRegistration<T> = T | Class<T>;

/** Port of `AbpJsonOptions` (+ the converter list of `AbpSystemTextJsonSerializerOptions`). */
export class AbpJsonOptions {
  /** .NET custom format strings (`yyyy-MM-dd HH:mm:ss`) tried before ISO 8601 when reading; empty = ISO only. */
  inputDateTimeFormats: string[] = [];
  /** .NET custom format string for written dates; undefined/empty = ISO 8601. */
  outputDateTimeFormat: string | undefined = undefined;
  /** Default of the `camelCase` parameter of `serialize` (the .NET method default). */
  camelCase = true;
  readonly inputConverters: JsonConverterRegistration<IJsonInputConverter>[] = [];
  readonly outputConverters: JsonConverterRegistration<IJsonOutputConverter>[] = [];
}
