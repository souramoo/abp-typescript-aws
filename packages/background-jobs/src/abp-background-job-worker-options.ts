import { createHash } from "node:crypto";
import { AbpException, ArgumentException, Check, type Class } from "@abp/core";

/** Port of `BackgroundJobWorkerConfiguration`: a dedicated worker that processes only specific job args types. */
export class BackgroundJobWorkerConfiguration {
  readonly lockName: string;
  readonly jobArgsTypes: readonly Class[];

  constructor(lockName: string, jobArgsTypes: readonly Class[]) {
    this.lockName = Check.notNullOrWhiteSpace(lockName, "lockName");
    Check.notNullOrEmptyArray(jobArgsTypes, "jobArgsTypes");
    if (jobArgsTypes.some((t) => typeof t !== "function")) throw new ArgumentException("Job args types cannot contain null.", "jobArgsTypes");
    this.jobArgsTypes = [...jobArgsTypes];
  }
}

/** Port of `DedicatedWorkerDefinition`: a validated dedicated worker (lock name + resolved job names). */
export class DedicatedWorkerDefinition {
  constructor(
    readonly lockName: string,
    readonly jobNames: readonly string[],
  ) {}
}

/** Port of `AbpBackgroundJobWorkerOptions`. Durations named as in .NET: `*Duration`/`*Timeout` in seconds, periods in milliseconds. */
export class AbpBackgroundJobWorkerOptions {
  applicationName: string | undefined;
  /** Interval (ms) between polling jobs from the store. Default: 5000. */
  jobPollPeriod = 5000;
  /** Maximum count of jobs to fetch from the store in one loop (also the cleanup batch size). Default: 1000. */
  maxJobFetchCount = 1000;
  /** Duration (seconds) of the first wait on a failure. Default: 60. */
  defaultFirstWaitDuration = 60;
  /** Timeout (seconds) for a job before it is abandoned. Default: 172800 (2 days). */
  defaultTimeout = 172800;
  /** Multiplied by the last wait time to calculate the next wait time. Default: 2. */
  defaultWaitFactor = 2.0;
  /** Distributed lock name of the default worker. */
  distributedLockName = "AbpBackgroundJobWorker";
  /** Keep successfully completed jobs (with `completionTime`) instead of deleting them. Default: false. */
  storeSuccessfulJobs = false;
  /** Retention (ms) of kept successful jobs; undefined keeps them forever. Default: 7 days. */
  successfulJobRetentionTime: number | undefined = 7 * 24 * 60 * 60 * 1000;
  /** Interval (ms) between cleanup runs. Default: 1 hour. */
  cleanSuccessfulJobsPeriod = 3_600_000;
  cleanupDistributedLockName = "AbpBackgroundJobCleanup";
  /** Dedicated workers; when not empty an additional default worker processes the remaining job types. */
  readonly workerConfigurations: BackgroundJobWorkerConfiguration[] = [];
  /** Jobs a worker executes in parallel per poll cycle; above 1 each job is claimed with its own lock. Default: 1. */
  maxParallelJobExecutionCount = 1;
  perJobDistributedLockPrefix = "AbpBackgroundJob:";

  /** `AddDedicatedWorker(lockName, ...argsTypes)` or `AddDedicatedWorker(...argsTypes)` (lock name derived from the types). */
  addDedicatedWorker(lockNameOrArgsType: string | Class, ...jobArgsTypes: Class[]): this {
    const types = typeof lockNameOrArgsType === "string" ? jobArgsTypes : [lockNameOrArgsType, ...jobArgsTypes];
    const lockName = typeof lockNameOrArgsType === "string" ? lockNameOrArgsType : this.getDedicatedWorkerLockName(types);
    Check.notNullOrEmptyArray(types, "jobArgsTypes");
    const configuration = new BackgroundJobWorkerConfiguration(lockName, [...new Set(types)]);

    const duplicateType = configuration.jobArgsTypes.find((type) => this.workerConfigurations.some((c) => c.jobArgsTypes.includes(type)));
    if (duplicateType) {
      throw new AbpException(`The background job args type '${duplicateType.name}' is already assigned to a dedicated worker. Each job type can be handled by only one dedicated worker.`);
    }
    if (lockName === this.distributedLockName || this.workerConfigurations.some((c) => c.lockName === lockName)) {
      throw new AbpException(`The distributed lock name '${lockName}' is already used by another background job worker. Each worker must have a unique lock name.`);
    }
    this.workerConfigurations.push(configuration);
    return this;
  }

  protected getDedicatedWorkerLockName(jobArgsTypes: readonly Class[]): string {
    Check.notNullOrEmptyArray(jobArgsTypes, "jobArgsTypes");
    const key = [...new Set(jobArgsTypes.map((t) => t.name))].sort().join(",");
    return "AbpBackgroundJobDedicatedWorker:" + createHash("md5").update(key).digest("hex");
  }
}
