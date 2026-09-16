import { Transient } from "@abp/core";
import { AbpControllerBase, Controller, HttpGet, HttpPost, body } from "@abp/aws-lambda";
import type { EmailSettingsDto} from "../application-contracts/index.js";
import { IEmailSettingsAppService, SendTestEmailInput, SettingManagementRemoteServiceConsts, UpdateEmailSettingsDto } from "../application-contracts/index.js";

/** Port of `EmailSettingsController`. */
@Transient()
@Controller("api/setting-management/emailing", { remoteServiceName: SettingManagementRemoteServiceConsts.RemoteServiceName, area: SettingManagementRemoteServiceConsts.ModuleName })
export class EmailSettingsController extends AbpControllerBase implements IEmailSettingsAppService {
  static readonly inject = [IEmailSettingsAppService] as const;

  constructor(private readonly emailSettingsAppService: IEmailSettingsAppService) {
    super();
  }

  @HttpGet("")
  get(): Promise<EmailSettingsDto> {
    return this.emailSettingsAppService.get();
  }

  @HttpPost("", body(UpdateEmailSettingsDto))
  update(input: UpdateEmailSettingsDto): Promise<void> {
    return this.emailSettingsAppService.update(input);
  }

  @HttpPost("send-test-email", body(SendTestEmailInput))
  sendTestEmail(input: SendTestEmailInput): Promise<void> {
    return this.emailSettingsAppService.sendTestEmail(input);
  }
}
