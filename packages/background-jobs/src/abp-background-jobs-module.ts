import { AbpModule, DependsOn, ServiceLifetime, implementationTypeOf, type ApplicationInitializationContext, type ServiceConfigurationContext } from "@abp/core";
import { AbpBackgroundWorkersModule, addBackgroundWorker } from "@abp/background-workers";
import { AbpDistributedLockingAbstractionsModule } from "@abp/distributed-locking";
import { AbpGuidsModule } from "@abp/guids";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpTimingModule } from "@abp/timing";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { AbpBackgroundJobWorkerOptions } from "./abp-background-job-worker-options.js";
import { AbpBackgroundJobsAbstractionsModule } from "./abp-background-jobs-abstractions-module.js";
import { BackgroundJobCleanupWorker } from "./background-job-cleanup-worker.js";
import { IBackgroundJobManager, NullBackgroundJobManager } from "./background-job-manager.js";
import { BackgroundJobWorkerManager } from "./background-job-worker-manager.js";
import { DefaultBackgroundJobManager } from "./default-background-job-manager.js";
import "./background-job-store.js";
import "./background-job-worker.js";

/** Port of `AbpBackgroundJobsModule`. */
@DependsOn(AbpBackgroundJobsAbstractionsModule, AbpBackgroundWorkersModule, AbpTimingModule, AbpGuidsModule, AbpDistributedLockingAbstractionsModule, AbpMultiTenancyModule)
export class AbpBackgroundJobsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const hasRealManager = context.services.getDescriptors(IBackgroundJobManager).some((d) => implementationTypeOf(d) !== NullBackgroundJobManager);
    if (!hasRealManager) context.services.replace(IBackgroundJobManager, DefaultBackgroundJobManager, ServiceLifetime.Transient);
  }

  override async onApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    await addBackgroundWorker(context, BackgroundJobWorkerManager);

    const jobOptions = context.serviceProvider.getOptions(AbpBackgroundJobOptions);
    const workerOptions = context.serviceProvider.getOptions(AbpBackgroundJobWorkerOptions);
    if (jobOptions.isJobExecutionEnabled && workerOptions.storeSuccessfulJobs && workerOptions.successfulJobRetentionTime !== undefined) {
      await addBackgroundWorker(context, BackgroundJobCleanupWorker);
    }
  }
}
