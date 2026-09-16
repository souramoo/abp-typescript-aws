import { type NameValue, Transient, createToken } from "@abp/core";
import { TimeZoneInfo } from "./time-zone-info.js";

/** Port of `ITimezoneProvider`. Only IANA ids exist at runtime; the Windows id members of .NET are not ported. */
export interface ITimezoneProvider {
  getIanaTimezones(): NameValue[];
  getTimeZoneInfo(ianaTimeZoneId: string): TimeZoneInfo;
}
export const ITimezoneProvider = createToken<ITimezoneProvider>("ITimezoneProvider");

/** Port of `TZConvertTimezoneProvider` backed by `Intl` instead of the TimeZoneConverter library. */
@Transient(ITimezoneProvider)
export class TZConvertTimezoneProvider implements ITimezoneProvider {
  getIanaTimezones(): NameValue[] {
    return Intl.supportedValuesOf("timeZone")
      .filter((x) => (x.includes("/") && !x.includes("Etc")) || x === "UTC")
      .sort()
      .map((x) => ({ name: x, value: x }));
  }

  getTimeZoneInfo(ianaTimeZoneId: string): TimeZoneInfo {
    return TimeZoneInfo.findSystemTimeZoneById(ianaTimeZoneId);
  }
}

/**
 * Port of `TimezoneProviderExtensions.ConvertUnspecifiedToUtc`: interprets a wall-clock `Date` as local time of
 * the given zone and returns the instant.
 */
export function convertUnspecifiedToUtc(timezoneProvider: ITimezoneProvider, dateTime: Date, ianaTimeZoneId: string): Date {
  return timezoneProvider.getTimeZoneInfo(ianaTimeZoneId).convertToUtc(dateTime);
}

/** Port of `TimeZoneHelper`. */
export const TimeZoneHelper = {
  /** Timezones ordered by name, enriched with the UTC offset, unknown ids dropped. */
  getTimezones(timezones: readonly NameValue[]): NameValue[] {
    return [...timezones]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((x) => TimeZoneHelper.tryCreateNameValueWithOffset(x))
      .filter((x): x is NameValue => x !== undefined);
  },
  tryCreateNameValueWithOffset(timeZone: NameValue): NameValue | undefined {
    try {
      const info = TimeZoneInfo.findSystemTimeZoneById(timeZone.name);
      return { name: `${timeZone.name} (${TimeZoneHelper.getTimezoneOffset(info)})`, value: timeZone.name };
    } catch {
      return undefined;
    }
  },
  /** Base UTC offset formatted as `+hh:mm` / `-hh:mm`. */
  getTimezoneOffset(timeZoneInfo: TimeZoneInfo): string {
    const minutes = timeZoneInfo.baseUtcOffset;
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${minutes < 0 ? "-" : "+"}${hh}:${mm}`;
  },
};
