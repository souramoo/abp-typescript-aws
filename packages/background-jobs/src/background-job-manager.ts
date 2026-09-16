import { AbpException, Dependency, ServiceLifetime, createToken, type Class } from "@abp/core";
import type { IBackgroundJob } from "./background-job.js";
import { BackgroundJobPriority } from "./background-job-priority.js";

/** The args class of a job, or the job class itself (its args class is read from `@BackgroundJob(Args)`). */
export type JobArgsOrJobType<TArgs extends object> = Class<TArgs> | Class<IBackgroundJob<TArgs>>;

/**
 * Port of `IBackgroundJobManager`. `TArgs` is erased, so `enqueue` takes the args class (or the job class) to
 * identify the job: `enqueue(MyJobArgs, new MyJobArgs(...))`. The AWS package replaces this with an SQS-based
 * manager; `IBackgroundJobExecuter.executeSerialized(jobName, argsJson)` is what its consumer calls.
 */
export interface IBackgroundJobManager {
  /** Enqueues a job by its job class; returns the job's unique identifier. `delayMs` is the wait before the first try. */
  enqueue<TArgs extends object>(jobType: Class<IBackgroundJob<TArgs>>, args: TArgs, priority?: BackgroundJobPriority, delayMs?: number): Promise<string>;
  /** Enqueues a job by its args class (`enqueue(MyJobArgs, new MyJobArgs(...))`). */
  enqueue<TArgs extends object>(argsType: Class<TArgs>, args: TArgs, priority?: BackgroundJobPriority, delayMs?: number): Promise<string>;
}
export const IBackgroundJobManager = createToken<IBackgroundJobManager>("IBackgroundJobManager");

/** Port of `NullBackgroundJobManager`: registered when no real implementation is (`TryRegister`). */
@Dependency({ lifetime: ServiceLifetime.Singleton, tryRegister: true, exposes: [IBackgroundJobManager] })
export class NullBackgroundJobManager implements IBackgroundJobManager {
  async enqueue(): Promise<string> {
    throw new AbpException("Background job system has not a real implementation. If it's mandatory, use an implementation (either the default provider or a 3rd party implementation). If it's optional, check isBackgroundJobManagerAvailable(manager) and act based on it.");
  }
}

/** Port of `BackgroundJobManagerExtensions.IsAvailable`. */
export function isBackgroundJobManagerAvailable(backgroundJobManager: IBackgroundJobManager): boolean {
  return !(backgroundJobManager instanceof NullBackgroundJobManager);
}

export { BackgroundJobPriority };
