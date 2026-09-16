import { AbpModule, DependsOn } from "@abp/core";
import { AbpBackgroundJobOptions, AbpBackgroundJobsAbstractionsModule } from "@abp/background-jobs";
import { AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpSettingsModule } from "@abp/settings";
import { AbpTextTemplatingModule, AbpTextTemplatingOptions } from "@abp/text-templating";
import { BackgroundEmailSendingJob } from "./background-email-sending-job.js";
import { abpEmailingEn, EmailingResource } from "./emailing-resource.js";
import { StandardEmailLayoutTemplate, StandardEmailMessageTemplate, StandardEmailTemplates } from "./templates/standard-email-templates.js";
import "./email-sender.js";
import "./email-sender-configuration.js";
import "./email-setting-provider.js";

/** Port of `AbpEmailingModule` (the virtual file system dependency is replaced by in-memory template contents). */
@DependsOn(AbpSettingsModule, AbpBackgroundJobsAbstractionsModule, AbpLocalizationModule, AbpTextTemplatingModule)
export class AbpEmailingModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(EmailingResource, "en").addJson(abpEmailingEn);
    });

    this.configure(AbpBackgroundJobOptions, (options) => {
      options.addJob(BackgroundEmailSendingJob);
    });

    this.configure(AbpTextTemplatingOptions, (options) => {
      options.contents.add(StandardEmailTemplates.Layout, undefined, StandardEmailLayoutTemplate);
      options.contents.add(StandardEmailTemplates.Message, undefined, StandardEmailMessageTemplate);
    });
  }
}
