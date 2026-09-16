import { AbpException } from "@abp/core";

/** Port of `TimeZoneNotFoundException`. */
export class TimeZoneNotFoundException extends AbpException {
  constructor(readonly timeZoneId: string) {
    super(`The time zone ID '${timeZoneId}' was not found on the local computer.`);
  }
}

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClockMs(instant: Date, timeZone: string): number {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const hour = fields["hour"] === 24 ? 0 : (fields["hour"] ?? 0);
  return Date.UTC(fields["year"] ?? 1970, (fields["month"] ?? 1) - 1, fields["day"] ?? 1, hour, fields["minute"] ?? 0, fields["second"] ?? 0, instant.getUTCMilliseconds());
}

/**
 * Port of `System.TimeZoneInfo` on top of `Intl`. Offsets are minutes east of UTC. A "wall-clock" `Date` is a
 * `Date` whose UTC fields hold the local time of a zone (the port of a `DateTimeKind.Unspecified` value).
 */
export class TimeZoneInfo {
  static readonly utc = new TimeZoneInfo("UTC");

  private constructor(readonly id: string) {}

  /** `TimeZoneInfo.FindSystemTimeZoneById`; throws {@link TimeZoneNotFoundException} for unknown IANA ids. */
  static findSystemTimeZoneById(id: string): TimeZoneInfo {
    try {
      return new TimeZoneInfo(formatterFor(id).resolvedOptions().timeZone);
    } catch (e) {
      if (e instanceof RangeError) throw new TimeZoneNotFoundException(id);
      throw e;
    }
  }

  /** Offset in force at the given instant, in minutes. */
  getUtcOffset(instant: Date): number {
    return Math.round((wallClockMs(instant, this.id) - instant.getTime()) / MINUTE);
  }

  /** Standard (non-daylight) offset in minutes: the smaller of the January and July offsets of the current year. */
  get baseUtcOffset(): number {
    const year = new Date().getUTCFullYear();
    return Math.min(this.getUtcOffset(new Date(Date.UTC(year, 0, 1))), this.getUtcOffset(new Date(Date.UTC(year, 6, 1))));
  }

  /** `TimeZoneInfo.ConvertTime(utc, zone)`: instant → wall-clock `Date` in this zone. */
  convertFromUtc(utcDateTime: Date): Date {
    return new Date(wallClockMs(utcDateTime, this.id));
  }

  /** `TimeZoneInfo.ConvertTimeToUtc(unspecified, zone)`: wall-clock `Date` in this zone → instant. */
  convertToUtc(wallClockDateTime: Date): Date {
    const wall = wallClockDateTime.getTime();
    let offset = this.getUtcOffset(new Date(wall - this.getUtcOffset(wallClockDateTime) * MINUTE));
    const candidate = wall - offset * MINUTE;
    const actual = this.getUtcOffset(new Date(candidate));
    if (actual !== offset) offset = actual;
    return new Date(wall - offset * MINUTE);
  }

  static convertTime(utcDateTime: Date, destination: TimeZoneInfo): Date {
    return destination.convertFromUtc(utcDateTime);
  }

  static convertTimeToUtc(wallClockDateTime: Date, source: TimeZoneInfo): Date {
    return source.convertToUtc(wallClockDateTime);
  }
}
