import { DisableConventionalRegistration, optionsToken, type Guid, type IOptions } from "@abp/core";
import { IGuidGenerator } from "@abp/guids";
import { IClock } from "@abp/timing";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { AbpBackgroundJobWorkerOptions } from "./abp-background-job-worker-options.js";
import { BackgroundJob } from "./background-job.js";
import { BackgroundJobInfo } from "./background-job-info.js";
import type { IBackgroundJobManager, JobArgsOrJobType } from "./background-job-manager.js";
import { BackgroundJobPriority } from "./background-job-priority.js";
import { IBackgroundJobSerializer } from "./background-job-serializer.js";
import { IBackgroundJobStore } from "./background-job-store.js";

/**
 * Port of `DefaultBackgroundJobManager`: stores `BackgroundJobInfo`s through `IBackgroundJobStore`. Registered by
 * `AbpBackgroundJobsModule` (not by convention, since this package also ships the abstractions and their null
 * manager) unless another real manager (e.g. the SQS one) is registered already.
 */
@DisableConventionalRegistration()
export class DefaultBackgroundJobManager implements IBackgroundJobManager {
  static readonly inject = [IClock, IBackgroundJobSerializer, IBackgroundJobStore, IGuidGenerator, optionsToken(AbpBackgroundJobOptions), optionsToken(AbpBackgroundJobWorkerOptions)] as const;

  constructor(
    protected readonly clock: IClock,
    protected readonly serializer: IBackgroundJobSerializer,
    protected readonly store: IBackgroundJobStore,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly backgroundJobOptions: IOptions<AbpBackgroundJobOptions>,
    protected readonly backgroundJobWorkerOptions: IOptions<AbpBackgroundJobWorkerOptions>,
  ) {}

  async enqueue<TArgs extends object>(argsOrJobType: JobArgsOrJobType<TArgs>, args: TArgs, priority = BackgroundJobPriority.Normal, delayMs?: number): Promise<string> {
    const argsType = BackgroundJob.getArgsTypeOrNull(argsOrJobType) ?? argsOrJobType;
    const jobName = this.backgroundJobOptions.value.getBackgroundJobName(argsType);
    return this.enqueueByName(jobName, args, priority, delayMs);
  }

  protected async enqueueByName(jobName: string, args: object, priority = BackgroundJobPriority.Normal, delayMs?: number): Promise<Guid> {
    const now = this.clock.now;
    const jobInfo = new BackgroundJobInfo({
      id: this.guidGenerator.create(),
      applicationName: this.backgroundJobWorkerOptions.value.applicationName,
      jobName,
      jobArgs: this.serializer.serialize(args),
      priority,
      creationTime: now,
      nextTryTime: delayMs === undefined ? now : new Date(now.getTime() + delayMs),
    });
    await this.store.insert(jobInfo);
    return jobInfo.id;
  }
}
