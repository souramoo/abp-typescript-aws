import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpBackgroundJobsAbstractionsModule } from "@abp/background-jobs";
import { AbpSqsBackgroundJobOptions } from "./abp-sqs-background-job-options.js";
import "./sqs-client-factory.js";
import "./sqs-background-job-manager.js";

/**
 * Registers `SqsBackgroundJobManager` as the `IBackgroundJobManager` (port of the RabbitMQ/Hangfire provider modules).
 * `AbpBackgroundJobOptions.isJobExecutionEnabled` is left untouched; the jobs Lambda honours it.
 */
@DependsOn(AbpBackgroundJobsAbstractionsModule)
export class AbpBackgroundJobsAwsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpSqsBackgroundJobOptions, (options) => {
      options.queueUrl ??= configuration?.get("BackgroundJobs:Aws:QueueUrl");
    });
  }
}
