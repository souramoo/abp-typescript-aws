import { Transient, UserFriendlyException, isNullOrWhiteSpace } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { EmailSettingNames, IEmailSender } from "@abp/emailing";
import { FeatureCheckerExtensions } from "@abp/features";
import { getCurrentTenantId } from "@abp/multi-tenancy-abstractions";
import { EmailSettingsDto, IEmailSettingsAppService, SettingManagementPermissions, type SendTestEmailInput, type UpdateEmailSettingsDto } from "../application-contracts/index.js";
import { ISettingManager, SettingManagerExtensions } from "../domain/index.js";
import { SettingManagementFeatures } from "../domain-shared/index.js";
import { SettingManagementAppServiceBase } from "./setting-management-app-service-base.js";

function toBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function toInt32(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** Port of `EmailSettingsAppService`: manages the `Abp.Mailing.*` settings of the host or the current tenant. */
@Transient(IEmailSettingsAppService)
@Authorize(SettingManagementPermissions.Emailing)
export class EmailSettingsAppService extends SettingManagementAppServiceBase implements IEmailSettingsAppService {
  static readonly inject = [ISettingManager, IEmailSender] as const;

  constructor(
    protected readonly settingManager: ISettingManager,
    protected readonly emailSender: IEmailSender,
  ) {
    super();
  }

  async get(): Promise<EmailSettingsDto> {
    await this.checkFeature();

    const settingsDto = new EmailSettingsDto();
    settingsDto.smtpHost = await this.settingProvider.getOrNull(EmailSettingNames.Smtp.Host);
    settingsDto.smtpPort = toInt32(await this.settingProvider.getOrNull(EmailSettingNames.Smtp.Port));
    settingsDto.smtpUserName = await this.settingProvider.getOrNull(EmailSettingNames.Smtp.UserName);
    settingsDto.smtpDomain = await this.settingProvider.getOrNull(EmailSettingNames.Smtp.Domain);
    settingsDto.smtpEnableSsl = toBoolean(await this.settingProvider.getOrNull(EmailSettingNames.Smtp.EnableSsl));
    settingsDto.smtpUseDefaultCredentials = toBoolean(await this.settingProvider.getOrNull(EmailSettingNames.Smtp.UseDefaultCredentials));
    settingsDto.defaultFromAddress = await this.settingProvider.getOrNull(EmailSettingNames.DefaultFromAddress);
    settingsDto.defaultFromDisplayName = await this.settingProvider.getOrNull(EmailSettingNames.DefaultFromDisplayName);

    if (this.currentTenant.isAvailable) {
      const tenantId = getCurrentTenantId(this.currentTenant);
      settingsDto.smtpHost = await SettingManagerExtensions.getOrNullForTenant(this.settingManager, EmailSettingNames.Smtp.Host, tenantId, false);
      settingsDto.smtpUserName = await SettingManagerExtensions.getOrNullForTenant(this.settingManager, EmailSettingNames.Smtp.UserName, tenantId, false);
      settingsDto.smtpDomain = await SettingManagerExtensions.getOrNullForTenant(this.settingManager, EmailSettingNames.Smtp.Domain, tenantId, false);
    }

    return settingsDto;
  }

  async update(input: UpdateEmailSettingsDto): Promise<void> {
    await this.checkFeature();

    const tenantId = this.currentTenant.id;
    const set = (name: string, value: string | undefined) => SettingManagerExtensions.setForTenantOrGlobal(this.settingManager, tenantId, name, value);

    await set(EmailSettingNames.Smtp.Host, input.smtpHost ?? undefined);
    await set(EmailSettingNames.Smtp.Port, String(input.smtpPort));
    await set(EmailSettingNames.Smtp.UserName, input.smtpUserName ?? undefined);
    if (!isNullOrWhiteSpace(input.smtpPassword)) await set(EmailSettingNames.Smtp.Password, input.smtpPassword);
    await set(EmailSettingNames.Smtp.Domain, input.smtpDomain ?? undefined);
    await set(EmailSettingNames.Smtp.EnableSsl, String(input.smtpEnableSsl));
    await set(EmailSettingNames.Smtp.UseDefaultCredentials, String(input.smtpUseDefaultCredentials));
    await set(EmailSettingNames.DefaultFromAddress, input.defaultFromAddress);
    await set(EmailSettingNames.DefaultFromDisplayName, input.defaultFromDisplayName);
  }

  @Authorize(SettingManagementPermissions.EmailingTest)
  async sendTestEmail(input: SendTestEmailInput): Promise<void> {
    await this.checkFeature();

    try {
      await this.emailSender.send({ from: input.senderEmailAddress, to: input.targetEmailAddress, subject: input.subject, body: input.body ?? undefined });
    } catch (e) {
      this.logger.error("Error sending test email", e);
      throw new UserFriendlyException(this.L.t("MailSendingFailed"));
    }
  }

  protected async checkFeature(): Promise<void> {
    await FeatureCheckerExtensions.checkEnabled(this.featureChecker, SettingManagementFeatures.Enable);
    if (this.currentTenant.isAvailable) await FeatureCheckerExtensions.checkEnabled(this.featureChecker, SettingManagementFeatures.AllowChangingEmailSettings);
  }
}
