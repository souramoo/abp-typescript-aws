import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn } from "@abp/core";
import {
  AbpClockOptions,
  AbpTimingModule,
  Clock,
  CurrentTimezoneProvider,
  DateTimeKind,
  DisableDateTimeNormalization,
  IClock,
  ICurrentTimezoneProvider,
  TZConvertTimezoneProvider,
  TimeZoneHelper,
  TimeZoneInfo,
  TimeZoneNotFoundException,
  TimingSettingNames,
  convertUnspecifiedToUtc,
  parseDateTime,
} from "../src/index.js";

function createClock(kind: DateTimeKind, currentTimezoneProvider = new CurrentTimezoneProvider()): Clock {
  const options = new AbpClockOptions();
  options.kind = kind;
  return new Clock({ value: options }, currentTimezoneProvider, new TZConvertTimezoneProvider());
}

const utc = (iso: string): Date => new Date(iso);
const wall = (iso: string): Date => new Date(`${iso}Z`);

describe("TimeZoneInfo", () => {
  it("computes fixed and daylight-saving offsets", () => {
    const istanbul = TimeZoneInfo.findSystemTimeZoneById("Europe/Istanbul");
    expect(istanbul.getUtcOffset(utc("2024-01-15T12:00:00Z"))).toBe(180);
    expect(istanbul.getUtcOffset(utc("2024-07-15T12:00:00Z"))).toBe(180);
    expect(istanbul.baseUtcOffset).toBe(180);

    const berlin = TimeZoneInfo.findSystemTimeZoneById("Europe/Berlin");
    expect(berlin.getUtcOffset(utc("2024-01-15T12:00:00Z"))).toBe(60);
    expect(berlin.getUtcOffset(utc("2024-07-15T12:00:00Z"))).toBe(120);
    expect(berlin.baseUtcOffset).toBe(60);

    const newYork = TimeZoneInfo.findSystemTimeZoneById("America/New_York");
    expect(newYork.getUtcOffset(utc("2024-01-15T12:00:00Z"))).toBe(-300);
    expect(TimeZoneHelper.getTimezoneOffset(newYork)).toBe("-05:00");
  });

  it("converts across the DST transition", () => {
    const berlin = TimeZoneInfo.findSystemTimeZoneById("Europe/Berlin");
    expect(berlin.convertFromUtc(utc("2024-03-31T00:59:59Z"))).toEqual(wall("2024-03-31T01:59:59"));
    expect(berlin.convertFromUtc(utc("2024-03-31T01:00:00Z"))).toEqual(wall("2024-03-31T03:00:00"));
    expect(berlin.convertToUtc(wall("2024-03-31T01:59:59"))).toEqual(utc("2024-03-31T00:59:59Z"));
    expect(berlin.convertToUtc(wall("2024-03-31T03:00:00"))).toEqual(utc("2024-03-31T01:00:00Z"));
    expect(berlin.convertToUtc(wall("2024-10-27T03:30:00"))).toEqual(utc("2024-10-27T02:30:00Z"));
  });

  it("rejects unknown zones", () => {
    expect(() => TimeZoneInfo.findSystemTimeZoneById("Mars/Olympus")).toThrow(TimeZoneNotFoundException);
    expect(TimeZoneHelper.tryCreateNameValueWithOffset({ name: "Mars/Olympus", value: "x" })).toBeUndefined();
    expect(TimeZoneHelper.getTimezones([{ name: "Europe/Istanbul", value: "Europe/Istanbul" }, { name: "Nope", value: "Nope" }])).toEqual([{ name: "Europe/Istanbul (+03:00)", value: "Europe/Istanbul" }]);
  });
});

describe("Clock", () => {
  it("does not convert when the kind is not Utc", () => {
    const provider = new CurrentTimezoneProvider();
    const clock = createClock(DateTimeKind.Unspecified, provider);
    expect(clock.supportsMultipleTimezone).toBe(false);
    provider.run("Europe/Istanbul", () => {
      const date = utc("2024-01-15T12:00:00Z");
      expect(clock.convertToUserTime(date)).toBe(date);
      expect(clock.convertToUtc(date)).toBe(date);
    });
  });

  it("converts between UTC and the ambient user time zone", () => {
    const provider = new CurrentTimezoneProvider();
    const clock = createClock(DateTimeKind.Utc, provider);
    expect(clock.supportsMultipleTimezone).toBe(true);
    const instant = utc("2024-01-15T12:00:00Z");
    expect(clock.convertToUserTime(instant)).toBe(instant);
    {
      using _scope = provider.change("Europe/Istanbul");
      expect(clock.convertToUserTime(instant)).toEqual(wall("2024-01-15T15:00:00"));
      expect(clock.convertToUtc(wall("2024-01-15T15:00:00"))).toEqual(instant);
    }
    expect(provider.timeZone).toBeUndefined();
    provider.run("Europe/Berlin", () => {
      expect(clock.convertToUserTime(utc("2024-07-01T12:00:00Z"))).toEqual(wall("2024-07-01T14:00:00"));
      expect(clock.convertToUtc(wall("2024-07-01T14:00:00"))).toEqual(utc("2024-07-01T12:00:00Z"));
    });
  });

  it("normalizes text according to the clock kind", () => {
    const utcClock = createClock(DateTimeKind.Utc);
    expect(utcClock.normalize("2024-01-15T10:00:00")).toEqual(utc("2024-01-15T10:00:00Z"));
    expect(utcClock.normalize("2024-01-15")).toEqual(utc("2024-01-15T00:00:00Z"));
    expect(utcClock.normalize("2024-01-15T10:00:00+03:00")).toEqual(utc("2024-01-15T07:00:00Z"));
    const date = new Date();
    expect(utcClock.normalize(date)).toBe(date);
    expect(Math.abs(utcClock.now.getTime() - Date.now())).toBeLessThan(1000);

    const localClock = createClock(DateTimeKind.Local);
    expect(localClock.normalize("2024-01-15T10:00:00").getHours()).toBe(10);
    expect(() => parseDateTime("not a date", DateTimeKind.Utc)).toThrow(/not a valid date time/);
  });

  it("convertUnspecifiedToUtc uses the given zone", () => {
    expect(convertUnspecifiedToUtc(new TZConvertTimezoneProvider(), wall("2024-01-15T15:00:00"), "Europe/Istanbul")).toEqual(utc("2024-01-15T12:00:00Z"));
  });
});

describe("DisableDateTimeNormalization", () => {
  it("marks classes and properties", () => {
    @DisableDateTimeNormalization()
    class Whole {}
    class Partial {
      @DisableDateTimeNormalization()
      creationTime!: Date;
      other!: Date;
    }
    class Child extends Partial {}
    expect(DisableDateTimeNormalization.isDisabled(Whole)).toBe(true);
    expect(DisableDateTimeNormalization.isDisabled(Partial)).toBe(false);
    expect(DisableDateTimeNormalization.isDisabled(Child, "creationTime")).toBe(true);
    expect(DisableDateTimeNormalization.isDisabled(Child, "other")).toBe(false);
  });
});

describe("AbpTimingModule", () => {
  it("registers the clock and providers and exposes setting names", async () => {
    @DependsOn(AbpTimingModule)
    class TestModule extends AbpModule {
      override configureServices(): void {
        this.configure(AbpClockOptions, (o) => (o.kind = DateTimeKind.Utc));
      }
    }
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const clock = app.serviceProvider.getRequired(IClock);
    expect(clock).toBeInstanceOf(Clock);
    expect(clock.kind).toBe(DateTimeKind.Utc);
    const current = app.serviceProvider.getRequired(ICurrentTimezoneProvider);
    expect(current).toBe(app.serviceProvider.getRequired(ICurrentTimezoneProvider));
    current.run("Europe/Istanbul", () => expect(clock.convertToUserTime(utc("2024-01-15T12:00:00Z"))).toEqual(wall("2024-01-15T15:00:00")));
    expect(TimingSettingNames.TimeZone).toBe("Abp.Timing.TimeZone");
    expect(new TZConvertTimezoneProvider().getIanaTimezones().map((x) => x.value)).toContain("Europe/Istanbul");
    await app.shutdown();
  });
});
