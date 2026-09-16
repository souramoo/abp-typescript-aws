import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpSmsModule } from "@abp/sms";
import { AbpSnsSmsOptions } from "./abp-sns-sms-options.js";
import "./sns-sms-sender.js";

/** Registers `SnsSmsSender` in place of `NullSmsSender`; binds `Sms:Aws:Region`, `Sms:Aws:SmsType`, `Sms:Aws:SenderId`. */
@DependsOn(AbpSmsModule)
export class AbpSmsAwsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpSnsSmsOptions, (options) => {
      options.region ??= configuration?.get("Sms:Aws:Region");
      options.senderId ??= configuration?.get("Sms:Aws:SenderId");
      const smsType = configuration?.get("Sms:Aws:SmsType");
      if (smsType === "Transactional" || smsType === "Promotional") options.smsType = smsType;
    });
  }
}
