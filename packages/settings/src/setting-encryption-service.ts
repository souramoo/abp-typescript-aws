import { ILoggerFactory, Transient, createToken, isNullOrEmptyString, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { IStringEncryptionService } from "@abp/security";
import { AbpSettingOptions } from "./abp-setting-options.js";
import type { SettingDefinition } from "./setting-definition.js";

/** Port of `ISettingEncryptionService`. */
export interface ISettingEncryptionService {
  encrypt(settingDefinition: SettingDefinition, plainValue: string | undefined): string | undefined;
  decrypt(settingDefinition: SettingDefinition, encryptedValue: string | undefined): string | undefined;
}
export const ISettingEncryptionService = createToken<ISettingEncryptionService>("ISettingEncryptionService");

/** Port of `SettingEncryptionService`. */
@Transient(ISettingEncryptionService)
export class SettingEncryptionService implements ISettingEncryptionService {
  static readonly inject = [IStringEncryptionService, optionsToken(AbpSettingOptions), ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly stringEncryptionService: IStringEncryptionService,
    protected readonly options: IOptions<AbpSettingOptions>,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(SettingEncryptionService.name);
  }

  encrypt(_settingDefinition: SettingDefinition, plainValue: string | undefined): string | undefined {
    if (isNullOrEmptyString(plainValue)) return plainValue;
    return this.stringEncryptionService.encrypt(plainValue);
  }

  decrypt(settingDefinition: SettingDefinition, encryptedValue: string | undefined): string | undefined {
    if (isNullOrEmptyString(encryptedValue)) return encryptedValue;
    try {
      return this.stringEncryptionService.decrypt(encryptedValue);
    } catch (e) {
      if (this.options.value.returnOriginalValueIfDecryptFailed) {
        this.logger.warn(`Failed to decrypt the setting: ${settingDefinition.name}. Returning the original value...`, undefined, e);
        return encryptedValue;
      }
      this.logger.logException(e);
      return "";
    }
  }
}
