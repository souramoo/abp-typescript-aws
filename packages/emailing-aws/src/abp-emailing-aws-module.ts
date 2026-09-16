import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpEmailingModule } from "@abp/emailing";
import { AbpSesEmailingOptions } from "./abp-ses-emailing-options.js";
import "./ses-email-sender.js";

/** Registers `SesEmailSender` in place of `NullEmailSender`; binds `Emailing:Aws:Region` and `Emailing:Aws:ConfigurationSetName`. */
@DependsOn(AbpEmailingModule)
export class AbpEmailingAwsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpSesEmailingOptions, (options) => {
      options.region ??= configuration?.get("Emailing:Aws:Region");
      options.configurationSetName ??= configuration?.get("Emailing:Aws:ConfigurationSetName");
    });
  }
}
