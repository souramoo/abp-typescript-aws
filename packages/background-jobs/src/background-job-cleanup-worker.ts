import { IServiceProviderToken, Singleton, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AsyncPeriodicBackgroundWorkerBase, type PeriodicBackgroundWorkerContext } from "@abp/background-workers";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { IClock } from "@abp/timing";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { AbpBackgroundJobWorkerOptions } from "./abp-background-job-worker-options.js";
import { IBackgroundJobStore } from "./background-job-store.js";

/** Port of `BackgroundJobCleanupWorker`: deletes kept successful jobs older than `successfulJobRetentionTime`. */
@Singleton()
export class BackgroundJobCleanupWorker extends AsyncPeriodicBackgroundWorkerBase {
  static override readonly inject = [IServiceProviderToken, optionsToken(AbpBackgroundJobOptions), optionsToken(AbpBackgroundJobWorkerOptions), IAbpDistributedLock] as const;
  protected readonly jobOptions: AbpBackgroundJobOptions;
  protected readonly workerOptions: AbpBackgroundJobWorkerOptions;

  constructor(
    serviceProvider: IServiceProvider,
    jobOptions: IOptions<AbpBackgroundJobOptions>,
    workerOptions: IOptions<AbpBackgroundJobWorkerOptions>,
    protected readonly distributedLock: IAbpDistributedLock,
  ) {
    super(serviceProvider);
    this.jobOptions = jobOptions.value;
    this.workerOptions = workerOptions.value;
    this.period = this.workerOptions.cleanSuccessfulJobsPeriod;
  }

  protected override async doWork(workerContext: PeriodicBackgroundWorkerContext): Promise<void> {
    const retention = this.workerOptions.successfulJobRetentionTime;
    if (!this.jobOptions.isJobExecutionEnabled || !this.workerOptions.storeSuccessfulJobs || retention === undefined) return;

    const store = workerContext.serviceProvider.getRequired(IBackgroundJobStore);
    const clock = workerContext.serviceProvider.getRequired(IClock);
    const completedBefore = new Date(clock.now.getTime() - retention);

    await using handle = await this.distributedLock.tryAcquire(this.workerOptions.cleanupDistributedLockName, 0, this.stoppingSignal);
    if (handle === undefined) return;

    let deletedCount: number;
    do {
      deletedCount = await store.deleteCompleted(this.workerOptions.applicationName, completedBefore, this.workerOptions.maxJobFetchCount, this.stoppingSignal);
    } while (deletedCount > 0 && deletedCount >= this.workerOptions.maxJobFetchCount && !this.stoppingSignal.aborted);
  }
}
