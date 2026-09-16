import { Transient, type NameValue } from "@abp/core";
import { AbpControllerBase, Controller, HttpGet, HttpPost, query } from "@abp/aws-lambda";
import { ITimeZoneSettingsAppService, SettingManagementRemoteServiceConsts } from "../application-contracts/index.js";

/** Port of `TimeZoneSettingsController`; `timezone` of `update` is a query value like the .NET simple-type binding. */
@Transient()
@Controller("api/setting-management/timezone", { remoteServiceName: SettingManagementRemoteServiceConsts.RemoteServiceName, area: SettingManagementRemoteServiceConsts.ModuleName })
export class TimeZoneSettingsController extends AbpControllerBase implements ITimeZoneSettingsAppService {
  static readonly inject = [ITimeZoneSettingsAppService] as const;

  constructor(private readonly timeZoneSettingsAppService: ITimeZoneSettingsAppService) {
    super();
  }

  @HttpGet("")
  get(): Promise<string> {
    return this.timeZoneSettingsAppService.get();
  }

  @HttpGet("timezones")
  getTimezones(): Promise<NameValue[]> {
    return this.timeZoneSettingsAppService.getTimezones();
  }

  @HttpPost("", query("timezone", { optional: false }))
  update(timezone: string): Promise<void> {
    return this.timeZoneSettingsAppService.update(timezone);
  }
}
