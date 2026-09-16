import { AbpException, IServiceProviderToken, Singleton, optionsToken, type Class, type IOptions, type IServiceProvider } from "@abp/core";
import type { IRunOnceBackgroundWorker } from "@abp/background-workers";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { AbpBackgroundJobWorkerOptions, DedicatedWorkerDefinition } from "./abp-background-job-worker-options.js";
import { BackgroundJobNameFilter } from "./background-job-name-filter.js";
import { IBackgroundJobWorker } from "./background-job-worker.js";

/**
 * Port of `BackgroundJobWorkerManager`: owns the job workers (one default worker, or one per dedicated
 * configuration plus a default worker for the remaining jobs). `runOnce()` polls every worker a single time.
 */
@Singleton()
export class BackgroundJobWorkerManager implements IRunOnceBackgroundWorker {
  static readonly inject = [optionsToken(AbpBackgroundJobOptions), optionsToken(AbpBackgroundJobWorkerOptions), IServiceProviderToken] as const;
  protected readonly jobOptions: AbpBackgroundJobOptions;
  protected readonly workerOptions: AbpBackgroundJobWorkerOptions;
  protected readonly workers: IBackgroundJobWorker[] = [];

  constructor(
    jobOptions: IOptions<AbpBackgroundJobOptions>,
    workerOptions: IOptions<AbpBackgroundJobWorkerOptions>,
    protected readonly serviceProvider: IServiceProvider,
  ) {
    this.jobOptions = jobOptions.value;
    this.workerOptions = workerOptions.value;
  }

  get activeWorkers(): readonly IBackgroundJobWorker[] {
    return this.workers;
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (!this.jobOptions.isJobExecutionEnabled || this.workers.length > 0) return;
    for (const worker of this.createWorkers()) {
      await worker.start(signal);
      this.workers.push(worker);
    }
  }

  async stop(signal?: AbortSignal): Promise<void> {
    for (const worker of this.workers) await worker.stop(signal);
    this.workers.length = 0;
  }

  async runOnce(): Promise<void> {
    if (!this.jobOptions.isJobExecutionEnabled) return;
    const workers = this.workers.length > 0 ? this.workers : this.createWorkers();
    for (const worker of workers) await worker.runOnce();
  }

  /** Validates the dedicated worker configurations and creates the configured (not yet started) workers. */
  protected createWorkers(): IBackgroundJobWorker[] {
    if (this.workerOptions.workerConfigurations.length === 0) return [this.createWorker()];

    const dedicatedWorkers: DedicatedWorkerDefinition[] = [];
    const allDedicatedJobNames: string[] = [];
    const lockNames = [this.workerOptions.distributedLockName];

    for (const configuration of this.workerOptions.workerConfigurations) {
      const jobNames = [...new Set(configuration.jobArgsTypes.map((t) => this.getJobName(t)))];
      const alreadyConfigured = jobNames.filter((n) => allDedicatedJobNames.includes(n));
      if (alreadyConfigured.length > 0) {
        throw new AbpException(`The following background job(s) are configured for more than one dedicated worker: ${alreadyConfigured.join(", ")}. Each job type can be handled by only one dedicated worker.`);
      }
      if (lockNames.includes(configuration.lockName)) {
        throw new AbpException(`The distributed lock name '${configuration.lockName}' is used by more than one background job worker (the default worker uses '${this.workerOptions.distributedLockName}'). Each worker must have a unique lock name to run independently.`);
      }
      lockNames.push(configuration.lockName);
      allDedicatedJobNames.push(...jobNames);
      dedicatedWorkers.push(new DedicatedWorkerDefinition(configuration.lockName, jobNames));
    }

    const workers = dedicatedWorkers.map((d) => this.createWorker(d.lockName, BackgroundJobNameFilter.include(d.jobNames)));
    workers.push(this.createWorker(undefined, BackgroundJobNameFilter.exclude(allDedicatedJobNames)));
    return workers;
  }

  protected getJobName(argsType: Class): string {
    try {
      return this.jobOptions.getJob(argsType).jobName;
    } catch (e) {
      throw new AbpException(`No background job is registered for the args type '${argsType.name}' configured via addDedicatedWorker. Register the job before configuring a dedicated worker for it.`, { cause: e });
    }
  }

  protected createWorker(distributedLockName?: string, jobNameFilter?: BackgroundJobNameFilter): IBackgroundJobWorker {
    const worker = this.serviceProvider.getRequired(IBackgroundJobWorker);
    worker.configure(distributedLockName, jobNameFilter);
    return worker;
  }
}
