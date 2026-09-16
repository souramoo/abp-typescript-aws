import { AbpException, type Class, type IOptions, type IServiceProvider, IServiceProviderToken, Transient, optionsToken, toCamelCase } from "@abp/core";
import { AbpJsonOptions, type IJsonInputConverter, type IJsonOutputConverter, type JsonConverterRegistration } from "./abp-json-options.js";
import { IJsonSerializer, type JsonSchema, type JsonSerializeOptions } from "./json-serializer.js";

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasToJson(value: object): value is { toJSON(key: string): unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === "function";
}

class JsonWriter {
  private readonly ancestors = new Set<object>();

  constructor(
    private readonly converters: readonly IJsonOutputConverter[],
    private readonly camelCase: boolean,
  ) {}

  convert(input: unknown, key = ""): unknown {
    let value = input;
    for (const converter of this.converters) {
      if (converter.canWrite(value)) {
        value = converter.write(value);
        break;
      }
    }
    if (value === null || typeof value !== "object") return value;
    if (hasToJson(value)) return this.convert(value.toJSON(key), key);
    if (this.ancestors.has(value)) throw new AbpException("Converting circular structure to JSON.");
    this.ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map((item, i) => this.convert(item, String(i)));
      const rename = this.camelCase && !isPlainObject(value);
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (typeof v === "function") continue;
        result[rename ? toCamelCase(k) : k] = this.convert(v, k);
      }
      return result;
    } finally {
      this.ancestors.delete(value);
    }
  }
}

/**
 * Port of `AbpSystemTextJsonSerializer` on the built-in `JSON` object. Output converters run on a pre-walk (so
 * `Date`, `Map`, `Set`, `bigint` are seen before `toJSON`), input converters run as a `JSON.parse` reviver.
 */
@Transient(IJsonSerializer)
export class AbpJsonSerializer implements IJsonSerializer {
  static readonly inject = [optionsToken(AbpJsonOptions), IServiceProviderToken] as const;
  protected readonly options: AbpJsonOptions;
  private outputConverterCache: readonly IJsonOutputConverter[] | undefined;
  private inputConverterCache: readonly IJsonInputConverter[] | undefined;

  constructor(
    options: IOptions<AbpJsonOptions>,
    protected readonly serviceProvider?: IServiceProvider,
  ) {
    this.options = options.value;
  }

  serialize(obj: unknown, { camelCase = this.options.camelCase, indented = false }: JsonSerializeOptions = {}): string {
    const converted = new JsonWriter(this.outputConverters, camelCase).convert(obj);
    return JSON.stringify(converted, undefined, indented ? 2 : undefined);
  }

  deserialize(jsonString: string): unknown;
  deserialize<T>(jsonString: string, schema: JsonSchema<T>): T;
  deserialize<T>(jsonString: string, schema?: JsonSchema<T>): unknown {
    const converters = this.inputConverters;
    const value: unknown = JSON.parse(jsonString, converters.length === 0 ? undefined : (_key, v: unknown) => this.revive(converters, v));
    if (!schema) return value;
    return ("schema" in schema ? schema.schema : schema).parse(value);
  }

  protected get outputConverters(): readonly IJsonOutputConverter[] {
    this.outputConverterCache ??= this.options.outputConverters.map((c) => this.resolve(c));
    return this.outputConverterCache;
  }

  protected get inputConverters(): readonly IJsonInputConverter[] {
    this.inputConverterCache ??= this.options.inputConverters.map((c) => this.resolve(c));
    return this.inputConverterCache;
  }

  private revive(converters: readonly IJsonInputConverter[], value: unknown): unknown {
    for (const converter of converters) {
      if (converter.canRead(value)) return converter.read(value);
    }
    return value;
  }

  private resolve<T extends object>(registration: JsonConverterRegistration<T>): T {
    if (typeof registration !== "function") return registration;
    const type: Class<T> = registration;
    if (!this.serviceProvider) throw new AbpException(`JSON converter '${type.name}' is registered as a class but no service provider is available to resolve it.`);
    return this.serviceProvider.getRequired(type);
  }
}
