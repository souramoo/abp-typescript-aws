import { AbpException } from "@abp/core";

/**
 * Port of `System.DateTimeKind`. A JavaScript `Date` is always an absolute instant, so the kind only decides how
 * text without a time zone designator (the .NET "Unspecified" case) is interpreted and how instants are written.
 */
export enum DateTimeKind {
  Unspecified = "Unspecified",
  Utc = "Utc",
  Local = "Local",
}

export class AbpClockOptions {
  /** Default: `DateTimeKind.Unspecified`. */
  kind: DateTimeKind = DateTimeKind.Unspecified;
}

const DESIGNATOR = /T.*(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True when the ISO 8601 text carries a `Z` or `±hh:mm` designator (a .NET `DateTimeKind.Utc`/`Local` value). */
export function hasTimeZoneDesignator(text: string): boolean {
  return DESIGNATOR.test(text.trim());
}

/**
 * Port of `DateTime.SpecifyKind` for text: a designator-less string is read as UTC wall-clock time under
 * `DateTimeKind.Utc` and as process-local time otherwise (JavaScript's own default).
 */
export function parseDateTime(text: string, kind: DateTimeKind): Date {
  const trimmed = text.trim();
  const unspecified = !hasTimeZoneDesignator(trimmed);
  const withTime = DATE_ONLY.test(trimmed) ? `${trimmed}T00:00:00` : trimmed;
  const date = new Date(unspecified && kind === DateTimeKind.Utc ? `${withTime}Z` : unspecified ? withTime : trimmed);
  if (Number.isNaN(date.getTime())) throw new AbpException(`'${text}' is not a valid date time.`);
  return date;
}
