import { type ILogger, ILoggerFactory, type IOptions, Transient, isNullOrWhiteSpace, optionsToken } from "@abp/core";
import { DateTimeKind, IClock, ICurrentTimezoneProvider, ITimezoneProvider, convertUnspecifiedToUtc, hasTimeZoneDesignator } from "@abp/timing";
import { AbpJsonOptions, type IJsonInputConverter, type IJsonOutputConverter } from "./abp-json-options.js";
import { formatDateTime, localFields, toUnspecifiedIso, tryParseExact, utcFields } from "./date-time-format.js";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Port of `AbpDateTimeConverter` (+ the nullable variant, unnecessary here). Writes instants as ISO 8601 (or
 * `outputDateTimeFormat`); reads ISO 8601 text with a time part (or `inputDateTimeFormats`). Designator-less
 * text is treated as the user's wall-clock time when the clock supports multiple time zones, otherwise it is
 * parsed by `IClock.normalize`. Dates with only a `yyyy-MM-dd` part stay strings: JSON carries no target type.
 */
@Transient()
export class AbpDateTimeConverter implements IJsonInputConverter, IJsonOutputConverter {
  static readonly inject = [IClock, optionsToken(AbpJsonOptions), ICurrentTimezoneProvider, ITimezoneProvider, ILoggerFactory] as const;
  protected readonly options: AbpJsonOptions;
  protected readonly logger: ILogger;

  constructor(
    protected readonly clock: IClock,
    options: IOptions<AbpJsonOptions>,
    protected readonly currentTimezoneProvider: ICurrentTimezoneProvider,
    protected readonly timezoneProvider: ITimezoneProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(AbpDateTimeConverter.name);
  }

  canWrite(value: unknown): boolean {
    return value instanceof Date;
  }

  write(value: unknown): unknown {
    if (!(value instanceof Date)) return value;
    const normalized = this.clock.normalize(value);
    const format = this.options.outputDateTimeFormat;
    if (isNullOrWhiteSpace(format)) return this.clock.kind === DateTimeKind.Local ? toLocalIso(normalized) : normalized.toISOString();
    return formatDateTime(this.clock.kind === DateTimeKind.Local ? localFields(normalized) : utcFields(normalized), format);
  }

  canRead(value: unknown): boolean {
    if (typeof value !== "string") return false;
    if (this.options.inputDateTimeFormats.length > 0 && this.options.inputDateTimeFormats.some((f) => tryParseExact(value, f) !== undefined)) return true;
    return ISO_DATE_TIME.test(value);
  }

  read(value: unknown): unknown {
    if (typeof value !== "string") return value;
    for (const format of this.options.inputDateTimeFormats) {
      const fields = tryParseExact(value, format);
      if (fields) return this.readUnspecified(toUnspecifiedIso(fields));
    }
    if (!ISO_DATE_TIME.test(value)) return value;
    return hasTimeZoneDesignator(value) ? new Date(value) : this.readUnspecified(value);
  }

  /** Port of `AbpDateTimeConverterBase.Normalize` for a `DateTimeKind.Unspecified` value. */
  protected readUnspecified(text: string): Date {
    const timeZone = this.currentTimezoneProvider.timeZone;
    if (this.clock.supportsMultipleTimezone && !isNullOrWhiteSpace(timeZone)) {
      try {
        return convertUnspecifiedToUtc(this.timezoneProvider, new Date(`${text}Z`), timeZone);
      } catch (e) {
        this.logger.warn(`Could not convert DateTime with unspecified Kind using timezone '${timeZone}'.`, { timeZone }, e);
      }
    }
    return this.clock.normalize(text);
  }
}

function toLocalIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${formatDateTime(localFields(date), "yyyy-MM-ddTHH:mm:ss.fff")}${sign}${hh}:${mm}`;
}

/** `bigint` has no JSON representation; written as a decimal string (what `JsonNumberHandling.WriteAsString` does). */
export class AbpBigIntConverter implements IJsonOutputConverter {
  canWrite(value: unknown): boolean {
    return typeof value === "bigint";
  }
  write(value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
  }
}

/** `Map` → plain object with stringified keys (the port of `IDictionary<TKey, TValue>` serialization). */
export class AbpMapConverter implements IJsonOutputConverter {
  canWrite(value: unknown): boolean {
    return value instanceof Map;
  }
  write(value: unknown): unknown {
    if (!(value instanceof Map)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of value) result[String(key)] = item;
    return result;
  }
}

/** `Set` → array (the port of `ISet<T>` serialization). */
export class AbpSetConverter implements IJsonOutputConverter {
  canWrite(value: unknown): boolean {
    return value instanceof Set;
  }
  write(value: unknown): unknown {
    return value instanceof Set ? [...value] : value;
  }
}
