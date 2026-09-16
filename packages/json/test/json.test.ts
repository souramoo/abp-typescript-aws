import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { AbpClockOptions, Clock, CurrentTimezoneProvider, DateTimeKind, TZConvertTimezoneProvider } from "@abp/timing";
import {
  AbpBigIntConverter,
  AbpDateTimeConverter,
  AbpJsonModule,
  AbpJsonOptions,
  AbpJsonSerializer,
  AbpMapConverter,
  AbpSetConverter,
  IJsonSerializer,
  type JsonParser,
  formatDateTime,
  tryParseExact,
  utcFields,
} from "../src/index.js";

function createSerializer(configure?: (options: AbpJsonOptions, clockOptions: AbpClockOptions) => void, currentTimezoneProvider = new CurrentTimezoneProvider()): AbpJsonSerializer {
  const options = new AbpJsonOptions();
  const clockOptions = new AbpClockOptions();
  clockOptions.kind = DateTimeKind.Utc;
  configure?.(options, clockOptions);
  const clock = new Clock({ value: clockOptions }, currentTimezoneProvider, new TZConvertTimezoneProvider());
  const dateTimeConverter = new AbpDateTimeConverter(clock, { value: options }, currentTimezoneProvider, new TZConvertTimezoneProvider(), NullLoggerFactory.instance);
  options.outputConverters.push(dateTimeConverter, new AbpBigIntConverter(), new AbpMapConverter(), new AbpSetConverter());
  options.inputConverters.push(dateTimeConverter);
  return new AbpJsonSerializer({ value: options });
}

class Address {
  constructor(
    readonly City: string,
    readonly Lines: string[],
  ) {}
}
class PersonDto {
  constructor(
    readonly Name: string,
    readonly BirthDate: Date,
    readonly Address: Address,
    readonly Tags: Map<string, number>,
  ) {}
}

describe("AbpJsonSerializer.serialize", () => {
  it("round-trips Date values as ISO 8601 UTC", () => {
    const serializer = createSerializer();
    const date = new Date("2024-01-15T12:34:56.789Z");
    const json = serializer.serialize({ when: date, list: [date], nested: { deep: date } });
    expect(json).toBe('{"when":"2024-01-15T12:34:56.789Z","list":["2024-01-15T12:34:56.789Z"],"nested":{"deep":"2024-01-15T12:34:56.789Z"}}');
    const back = serializer.deserialize(json, {
      parse: (v) => v as { when: Date; list: Date[]; nested: { deep: Date } },
    });
    expect(back.when).toBeInstanceOf(Date);
    expect(back.when.getTime()).toBe(date.getTime());
    expect(back.list[0]).toEqual(date);
    expect(back.nested.deep).toEqual(date);
  });

  it("camel-cases class instance properties but keeps plain object and Map keys", () => {
    const serializer = createSerializer();
    const person = new PersonDto("Ada", new Date("1815-12-10T00:00:00Z"), new Address("London", ["1 Street"]), new Map([["Rank", 1]]));
    const json = serializer.serialize({ person, Extra: { SocialSecurityNumber: "x" } });
    expect(JSON.parse(json)).toEqual({
      person: { name: "Ada", birthDate: "1815-12-10T00:00:00.000Z", address: { city: "London", lines: ["1 Street"] }, tags: { Rank: 1 } },
      Extra: { SocialSecurityNumber: "x" },
    });
    expect(JSON.parse(serializer.serialize(person, { camelCase: false }))).toMatchObject({ Name: "Ada", Address: { City: "London" } });
  });

  it("writes indented output, bigint, Set and honours toJSON", () => {
    const serializer = createSerializer();
    expect(serializer.serialize({ a: 1 }, { indented: true })).toBe('{\n  "a": 1\n}');
    expect(serializer.serialize({ big: 2n ** 64n, set: new Set([1, 2]) })).toBe('{"big":"18446744073709551616","set":[1,2]}');
    expect(serializer.serialize({ custom: { toJSON: () => ({ At: new Date(0) }) } })).toBe('{"custom":{"At":"1970-01-01T00:00:00.000Z"}}');
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => serializer.serialize(cyclic)).toThrow(/circular/);
  });

  it("uses outputDateTimeFormat when configured", () => {
    const serializer = createSerializer((o) => (o.outputDateTimeFormat = "yyyy-MM-dd HH:mm:ss"));
    expect(serializer.serialize(new Date("2024-01-15T12:34:56.789Z"))).toBe('"2024-01-15 12:34:56"');
  });
});

describe("AbpJsonSerializer.deserialize", () => {
  it("returns unknown without a schema and parses through a schema or a class with static schema", () => {
    const serializer = createSerializer();
    const raw: unknown = serializer.deserialize('{"name":"x","n":1}');
    expect(raw).toEqual({ name: "x", n: 1 });
    class Dto {
      static readonly schema: JsonParser<Dto> = {
        parse: (input) => {
          if (typeof input !== "object" || input === null || typeof (input as Dto).name !== "string") throw new Error("invalid");
          return Object.assign(new Dto(), input);
        },
      };
      name = "";
    }
    const dto = serializer.deserialize('{"name":"abp"}', Dto);
    expect(dto).toBeInstanceOf(Dto);
    expect(dto.name).toBe("abp");
    expect(() => serializer.deserialize('{"name":1}', Dto)).toThrow("invalid");
  });

  it("reads ISO date-time strings, leaving date-only and other strings untouched", () => {
    const serializer = createSerializer();
    const result = serializer.deserialize('{"a":"2024-01-15T10:00:00Z","b":"2024-01-15T10:00:00+03:00","c":"2024-01-15","d":"hello","e":"2024-01-15T10:00"}', { parse: (v) => v as Record<string, unknown> });
    expect(result["a"]).toEqual(new Date("2024-01-15T10:00:00Z"));
    expect(result["b"]).toEqual(new Date("2024-01-15T07:00:00Z"));
    expect(result["c"]).toBe("2024-01-15");
    expect(result["d"]).toBe("hello");
    expect(result["e"]).toEqual(new Date("2024-01-15T10:00:00Z"));
  });

  it("interprets designator-less text in the ambient user time zone (Utc clock)", () => {
    const provider = new CurrentTimezoneProvider();
    const serializer = createSerializer(undefined, provider);
    expect(serializer.deserialize('"2024-01-15T15:00:00"')).toEqual(new Date("2024-01-15T15:00:00Z"));
    provider.run("Europe/Istanbul", () => {
      expect(serializer.deserialize('"2024-01-15T15:00:00"')).toEqual(new Date("2024-01-15T12:00:00Z"));
      expect(serializer.deserialize('"2024-01-15T15:00:00Z"')).toEqual(new Date("2024-01-15T15:00:00Z"));
    });
  });

  it("tries inputDateTimeFormats first", () => {
    const serializer = createSerializer((o) => o.inputDateTimeFormats.push("dd/MM/yyyy HH:mm"));
    expect(serializer.deserialize('{"at":"15/01/2024 09:30"}')).toEqual({ at: new Date("2024-01-15T09:30:00Z") });
    expect(serializer.deserialize('"31/12/2024 23:59"')).toEqual(new Date("2024-12-31T23:59:00Z"));
    expect(serializer.deserialize('"nope"')).toBe("nope");
  });
});

describe("date time format", () => {
  it("formats and parses .NET custom format tokens", () => {
    const fields = utcFields(new Date("2024-03-05T07:08:09.045Z"));
    expect(formatDateTime(fields, "yyyy-MM-dd HH:mm:ss.fff")).toBe("2024-03-05 07:08:09.045");
    expect(formatDateTime(fields, "d/M/yy H:m:s")).toBe("5/3/24 7:8:9");
    expect(tryParseExact("2024-03-05 07:08:09.045", "yyyy-MM-dd HH:mm:ss.fff")).toEqual(fields);
    expect(tryParseExact("5/3/24 7:8:9", "d/M/yy H:m:s")).toEqual({ ...fields, millisecond: 0 });
    expect(tryParseExact("2024-13-05", "yyyy-MM-dd")).toBeUndefined();
    expect(tryParseExact("garbage", "yyyy-MM-dd")).toBeUndefined();
  });
});

describe("AbpJsonModule", () => {
  it("registers IJsonSerializer with the default converters", async () => {
    @DependsOn(AbpJsonModule)
    class AppModule extends AbpModule {
      override configureServices(): void {
        this.configure(AbpClockOptions, (o) => (o.kind = DateTimeKind.Utc));
      }
    }
    const app = await AbpApplication.create(AppModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const serializer = app.serviceProvider.getRequired(IJsonSerializer);
    expect(serializer).toBeInstanceOf(AbpJsonSerializer);
    const json = serializer.serialize({ at: new Date("2024-01-15T10:00:00Z"), m: new Map([["k", 1n]]) });
    expect(json).toBe('{"at":"2024-01-15T10:00:00.000Z","m":{"k":"1"}}');
    expect(serializer.deserialize(json)).toEqual({ at: new Date("2024-01-15T10:00:00Z"), m: { k: "1" } });
    await app.shutdown();
  });
});
