import { Transient, isNullOrWhiteSpace, type NameValue } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { MultiTenancySides, getMultiTenancySide } from "@abp/multi-tenancy-abstractions";
import { ITimezoneProvider, TimeZoneHelper, TimingSettingNames } from "@abp/timing";
import { ITimeZoneSettingsAppService, SettingManagementPermissions } from "../application-contracts/index.js";
import { ISettingManager, SettingManagerExtensions } from "../domain/index.js";
import { SettingManagementAppServiceBase } from "./setting-management-app-service-base.js";

const UnspecifiedTimeZone = "Unspecified";

/** Port of `TimeZoneSettingsAppService`: the `Abp.Timing.TimeZone` setting of the host or the current tenant. */
@Transient(ITimeZoneSettingsAppService)
@Authorize(SettingManagementPermissions.TimeZone)
export class TimeZoneSettingsAppService extends SettingManagementAppServiceBase implements ITimeZoneSettingsAppService {
  static readonly inject = [ISettingManager, ITimezoneProvider] as const;

  constructor(
    protected readonly settingManager: ISettingManager,
    protected readonly timezoneProvider: ITimezoneProvider,
  ) {
    super();
  }

  async get(): Promise<string> {
    const timezone =
      getMultiTenancySide(this.currentTenant) === MultiTenancySides.Host
        ? await SettingManagerExtensions.getOrNullGlobal(this.settingManager, TimingSettingNames.TimeZone)
        : await SettingManagerExtensions.getOrNullForCurrentTenant(this.settingManager, TimingSettingNames.TimeZone);
    return isNullOrWhiteSpace(timezone) ? UnspecifiedTimeZone : timezone;
  }

  async getTimezones(): Promise<NameValue[]> {
    const timezones = TimeZoneHelper.getTimezones(this.timezoneProvider.getIanaTimezones());
    timezones.unshift({ name: this.L.t("DefaultTimeZone"), value: UnspecifiedTimeZone });
    return timezones;
  }

  async update(timezone: string): Promise<void> {
    const value = timezone.toLowerCase() === UnspecifiedTimeZone.toLowerCase() ? undefined : timezone;
    if (getMultiTenancySide(this.currentTenant) === MultiTenancySides.Host) {
      await SettingManagerExtensions.setGlobal(this.settingManager, TimingSettingNames.TimeZone, value);
    } else {
      await SettingManagerExtensions.setForCurrentTenant(this.settingManager, TimingSettingNames.TimeZone, value);
    }
  }
}
