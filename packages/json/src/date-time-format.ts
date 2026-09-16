import { AbpException } from "@abp/core";

export interface DateTimeFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const TOKEN = /yyyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s|fff|ff|f/g;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Minimal port of .NET custom date/time format strings (`yyyy`, `MM`, `dd`, `HH`, `mm`, `ss`, `fff` and their
 * single-letter variants); every other character is literal.
 */
export function formatDateTime(fields: DateTimeFields, format: string): string {
  return format.replace(TOKEN, (token) => {
    switch (token) {
      case "yyyy":
        return String(fields.year).padStart(4, "0");
      case "yy":
        return String(fields.year % 100).padStart(2, "0");
      case "MM":
        return String(fields.month).padStart(2, "0");
      case "M":
        return String(fields.month);
      case "dd":
        return String(fields.day).padStart(2, "0");
      case "d":
        return String(fields.day);
      case "HH":
        return String(fields.hour).padStart(2, "0");
      case "H":
        return String(fields.hour);
      case "mm":
        return String(fields.minute).padStart(2, "0");
      case "m":
        return String(fields.minute);
      case "ss":
        return String(fields.second).padStart(2, "0");
      case "s":
        return String(fields.second);
      case "fff":
        return String(fields.millisecond).padStart(3, "0");
      case "ff":
        return String(Math.floor(fields.millisecond / 10)).padStart(2, "0");
      case "f":
        return String(Math.floor(fields.millisecond / 100));
      default:
        throw new AbpException(`Unsupported date time format token '${token}'.`);
    }
  });
}

const parserCache = new Map<string, { regex: RegExp; tokens: string[] }>();

function parserFor(format: string): { regex: RegExp; tokens: string[] } {
  let parser = parserCache.get(format);
  if (parser) return parser;
  const tokens: string[] = [];
  let pattern = "^";
  let last = 0;
  for (const match of format.matchAll(TOKEN)) {
    pattern += escapeRegExp(format.slice(last, match.index));
    const token = match[0];
    tokens.push(token);
    pattern += token.length === 1 ? "(\\d{1,2})" : token === "yyyy" ? "(\\d{4})" : token === "fff" ? "(\\d{3})" : `(\\d{${token.length}})`;
    last = match.index + token.length;
  }
  pattern += escapeRegExp(format.slice(last)) + "$";
  parser = { regex: new RegExp(pattern), tokens };
  parserCache.set(format, parser);
  return parser;
}

/** Port of `DateTime.TryParseExact` for the tokens supported by {@link formatDateTime}. */
export function tryParseExact(text: string, format: string): DateTimeFields | undefined {
  const { regex, tokens } = parserFor(format);
  const match = regex.exec(text);
  if (!match) return undefined;
  const fields: DateTimeFields = { year: 1, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 };
  tokens.forEach((token, i) => {
    const value = Number(match[i + 1]);
    switch (token[0]) {
      case "y":
        fields.year = token === "yy" ? 2000 + value : value;
        break;
      case "M":
        fields.month = value;
        break;
      case "d":
        fields.day = value;
        break;
      case "H":
        fields.hour = value;
        break;
      case "m":
        fields.minute = value;
        break;
      case "s":
        fields.second = value;
        break;
      case "f":
        fields.millisecond = value * 10 ** (3 - token.length);
        break;
    }
  });
  if (fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 31 || fields.hour > 23 || fields.minute > 59 || fields.second > 59) return undefined;
  return fields;
}

export function utcFields(date: Date): DateTimeFields {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), millisecond: date.getUTCMilliseconds() };
}

export function localFields(date: Date): DateTimeFields {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds() };
}

/** Designator-less ISO 8601 text (`yyyy-MM-ddTHH:mm:ss.fff`), the port of a `DateTimeKind.Unspecified` value. */
export function toUnspecifiedIso(fields: DateTimeFields): string {
  return formatDateTime(fields, "yyyy-MM-ddTHH:mm:ss.fff");
}
