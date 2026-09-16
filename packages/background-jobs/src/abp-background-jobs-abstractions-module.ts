import { AbpModule, DependsOn, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { isDataMigrationEnvironment } from "@abp/data";
import { AbpJsonModule } from "@abp/json";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { BackgroundJob } from "./background-job.js";
import "./background-job-executer.js";
import "./background-job-manager.js";
import "./background-job-serializer.js";

/** Port of `AbpBackgroundJobsAbstractionsModule`: auto-adds registered `@BackgroundJob(Args)` classes to the options. */
@DependsOn(AbpJsonModule, AbpMultiTenancyAbstractionsModule)
export class AbpBackgroundJobsAbstractionsModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    registerJobs(context.services);
  }

  override configureServices(context: ServiceConfigurationContext): void {
    if (isDataMigrationEnvironment(context.services)) {
      this.configure(AbpBackgroundJobOptions, (options) => {
        options.isJobExecutionEnabled = false;
      });
    }
  }
}

function registerJobs(services: ServiceCollection): void {
  const jobTypes: Class[] = [];
  services.onRegistered((context) => {
    if (BackgroundJob.has(context.implementationType)) jobTypes.push(context.implementationType);
  });
  services.options.configure(AbpBackgroundJobOptions, (options) => {
    for (const jobType of jobTypes) options.addJob(jobType);
  });
}
