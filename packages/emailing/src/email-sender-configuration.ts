import { AbpException, Transient, createToken, isNullOrEmptyString, type ServiceKey } from "@abp/core";
import { ISettingProvider } from "@abp/settings";
import { EmailSettingNames } from "./email-setting-names.js";

/** Port of `IEmailSenderConfiguration`: configurations used while sending emails. */
export interface IEmailSenderConfiguration {
  getDefaultFromAddress(): Promise<string>;
  getDefaultFromDisplayName(): Promise<string>;
}
export const IEmailSenderConfiguration = createToken<IEmailSenderConfiguration>("IEmailSenderConfiguration");

/** Port of `EmailSenderConfiguration`: reads the settings from `ISettingProvider`. */
export abstract class EmailSenderConfiguration implements IEmailSenderConfiguration {
  static readonly inject: readonly ServiceKey[] = [ISettingProvider];

  constructor(protected readonly settingProvider: ISettingProvider) {}

  getDefaultFromAddress(): Promise<string> {
    return this.getNotEmptySettingValue(EmailSettingNames.DefaultFromAddress);
  }

  getDefaultFromDisplayName(): Promise<string> {
    return this.getNotEmptySettingValue(EmailSettingNames.DefaultFromDisplayName);
  }

  /** Gets a setting value; throws when it is null or empty. */
  protected async getNotEmptySettingValue(name: string): Promise<string> {
    const value = await this.settingProvider.getOrNull(name);
    if (isNullOrEmptyString(value)) throw new AbpException(`Setting value for '${name}' is null or empty!`);
    return value;
  }
}

/** Port of `ISmtpEmailSenderConfiguration`: the SMTP settings (no SMTP client ships with this port). */
export interface ISmtpEmailSenderConfiguration extends IEmailSenderConfiguration {
  getHost(): Promise<string>;
  getPort(): Promise<number>;
  getUserName(): Promise<string>;
  getPassword(): Promise<string>;
  getDomain(): Promise<string | undefined>;
  getEnableSsl(): Promise<boolean>;
  getUseDefaultCredentials(): Promise<boolean>;
}
export const ISmtpEmailSenderConfiguration = createToken<ISmtpEmailSenderConfiguration>("ISmtpEmailSenderConfiguration");

/**
 * Port of `SmtpEmailSenderConfiguration`. As in .NET it is the registered `IEmailSenderConfiguration`, so every
 * sender reads the default from address/display name from the settings it defines.
 */
@Transient(ISmtpEmailSenderConfiguration, IEmailSenderConfiguration)
export class SmtpEmailSenderConfiguration extends EmailSenderConfiguration implements ISmtpEmailSenderConfiguration {
  static override readonly inject = [ISettingProvider] as const;

  getHost(): Promise<string> {
    return this.getNotEmptySettingValue(EmailSettingNames.Smtp.Host);
  }

  async getPort(): Promise<number> {
    return Number(await this.getNotEmptySettingValue(EmailSettingNames.Smtp.Port));
  }

  getUserName(): Promise<string> {
    return this.getNotEmptySettingValue(EmailSettingNames.Smtp.UserName);
  }

  getPassword(): Promise<string> {
    return this.getNotEmptySettingValue(EmailSettingNames.Smtp.Password);
  }

  getDomain(): Promise<string | undefined> {
    return this.settingProvider.getOrNull(EmailSettingNames.Smtp.Domain);
  }

  async getEnableSsl(): Promise<boolean> {
    return (await this.getNotEmptySettingValue(EmailSettingNames.Smtp.EnableSsl)).toLowerCase() === "true";
  }

  async getUseDefaultCredentials(): Promise<boolean> {
    return (await this.getNotEmptySettingValue(EmailSettingNames.Smtp.UseDefaultCredentials)).toLowerCase() === "true";
  }
}
