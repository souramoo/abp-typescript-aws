import { type IOptions, Transient, createToken, isNullOrWhiteSpace, optionsToken } from "@abp/core";
import { AbpClockOptions, DateTimeKind, parseDateTime } from "./date-time-kind.js";
import { ICurrentTimezoneProvider } from "./current-timezone-provider.js";
import { ITimezoneProvider } from "./timezone-provider.js";

/**
 * Port of `IClock`. "User time" values are wall-clock `Date`s (UTC fields hold the local time of the user's
 * zone), which is how this port represents a .NET `DateTime` that is not UTC.
 */
export interface IClock {
  readonly now: Date;
  readonly kind: DateTimeKind;
  readonly supportsMultipleTimezone: boolean;
  /** A `Date` is already an instant and is returned as is; text is parsed according to {@link kind}. */
  normalize(dateTime: Date | string): Date;
  /** Converts a UTC instant to the user's wall-clock time when `supportsMultipleTimezone` and a user zone is set. */
  convertToUserTime(utcDateTime: Date): Date;
  /** Converts a wall-clock `Date` in the user's zone back to a UTC instant; otherwise returns it unchanged. */
  convertToUtc(dateTime: Date): Date;
}
export const IClock = createToken<IClock>("IClock");

@Transient(IClock)
export class Clock implements IClock {
  static readonly inject = [optionsToken(AbpClockOptions), ICurrentTimezoneProvider, ITimezoneProvider] as const;
  protected readonly options: AbpClockOptions;

  constructor(
    options: IOptions<AbpClockOptions>,
    protected readonly currentTimezoneProvider: ICurrentTimezoneProvider,
    protected readonly timezoneProvider: ITimezoneProvider,
  ) {
    this.options = options.value;
  }

  get now(): Date {
    return new Date();
  }

  get kind(): DateTimeKind {
    return this.options.kind;
  }

  get supportsMultipleTimezone(): boolean {
    return this.options.kind === DateTimeKind.Utc;
  }

  normalize(dateTime: Date | string): Date {
    return dateTime instanceof Date ? dateTime : parseDateTime(dateTime, this.kind);
  }

  convertToUserTime(utcDateTime: Date): Date {
    const timeZone = this.userTimeZone();
    if (timeZone === undefined) return utcDateTime;
    return this.timezoneProvider.getTimeZoneInfo(timeZone).convertFromUtc(utcDateTime);
  }

  convertToUtc(dateTime: Date): Date {
    const timeZone = this.userTimeZone();
    if (timeZone === undefined) return dateTime;
    return this.timezoneProvider.getTimeZoneInfo(timeZone).convertToUtc(dateTime);
  }

  private userTimeZone(): string | undefined {
    if (!this.supportsMultipleTimezone) return undefined;
    const timeZone = this.currentTimezoneProvider.timeZone;
    return isNullOrWhiteSpace(timeZone) ? undefined : timeZone;
  }
}
