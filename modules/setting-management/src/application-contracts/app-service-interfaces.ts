import { createToken, type NameValue } from "@abp/core";
import type { IApplicationService } from "@abp/ddd-application";
import type { EmailSettingsDto, SendTestEmailInput, UpdateEmailSettingsDto } from "./dtos.js";

/** Port of `SettingManagementRemoteServiceConsts`. */
export const SettingManagementRemoteServiceConsts = {
  RemoteServiceName: "SettingManagement",
  ModuleName: "settingManagement",
} as const;

/** Port of `IEmailSettingsAppService`. */
export interface IEmailSettingsAppService extends IApplicationService {
  get(): Promise<EmailSettingsDto>;
  update(input: UpdateEmailSettingsDto): Promise<void>;
  sendTestEmail(input: SendTestEmailInput): Promise<void>;
}
export const IEmailSettingsAppService = createToken<IEmailSettingsAppService>("IEmailSettingsAppService");

/** Port of `ITimeZoneSettingsAppService`: the time zone is an IANA id, or `Unspecified` for the server default. */
export interface ITimeZoneSettingsAppService extends IApplicationService {
  get(): Promise<string>;
  getTimezones(): Promise<NameValue[]>;
  update(timezone: string): Promise<void>;
}
export const ITimeZoneSettingsAppService = createToken<ITimeZoneSettingsAppService>("ITimeZoneSettingsAppService");
