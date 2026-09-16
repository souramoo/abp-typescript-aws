import { ExceptionNotificationContext, IExceptionNotifier, IServiceProviderToken, Transient, createToken, delay, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { AsyncPeriodicBackgroundWorkerBase, PeriodicBackgroundWorkerContext, type IBackgroundWorker } from "@abp/background-workers";
import { IAbpDistributedLock, type IAbpDistributedLockHandle } from "@abp/distributed-locking";
import { IClock } from "@abp/timing";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { AbpBackgroundJobWorkerOptions } from "./abp-background-job-worker-options.js";
import { BackgroundJobExecutionException, IBackgroundJobExecuter, JobExecutionContext } from "./background-job-executer.js";
import type { BackgroundJobInfo } from "./background-job-info.js";
import { BackgroundJobNameFilter } from "./background-job-name-filter.js";
import { IBackgroundJobSerializer } from "./background-job-serializer.js";
import { IBackgroundJobStore } from "./background-job-store.js";

/**
 * Port of `IBackgroundJobWorker`. Instances are created, configured and started by `BackgroundJobWorkerManager`.
 * The .NET `StartAsync(lockName, filter)` parameters moved to `configure()` so `start(signal)` keeps the
 * `IBackgroundWorker` shape and `runOnce()` is available for serverless hosting.
 */
export interface IBackgroundJobWorker extends IBackgroundWorker {
  /** `distributedLockName` defaults to `AbpBackgroundJobWorkerOptions.distributedLockName`; no filter processes all jobs. */
  configure(distributedLockName?: string, jobNameFilter?: BackgroundJobNameFilter): void;
  runOnce(): Promise<void>;
}
export const IBackgroundJobWorker = createToken<IBackgroundJobWorker>("IBackgroundJobWorker");

/** Port of `BackgroundJobWorker` on top of `AsyncPeriodicBackgroundWorkerBase` (poll → lock → execute → retry/abandon). */
@Transient(IBackgroundJobWorker)
export class BackgroundJobWorker extends AsyncPeriodicBackgroundWorkerBase implements IBackgroundJobWorker {
  static override readonly inject = [IServiceProviderToken, optionsToken(AbpBackgroundJobOptions), optionsToken(AbpBackgroundJobWorkerOptions), IAbpDistributedLock] as const;
  protected readonly jobOptions: AbpBackgroundJobOptions;
  protected readonly workerOptions: AbpBackgroundJobWorkerOptions;
  protected distributedLockName: string;
  protected jobNameFilter = BackgroundJobNameFilter.None;

  constructor(
    serviceProvider: IServiceProvider,
    jobOptions: IOptions<AbpBackgroundJobOptions>,
    workerOptions: IOptions<AbpBackgroundJobWorkerOptions>,
    protected readonly distributedLock: IAbpDistributedLock,
  ) {
    super(serviceProvider);
    this.jobOptions = jobOptions.value;
    this.workerOptions = workerOptions.value;
    this.distributedLockName = this.workerOptions.distributedLockName;
    this.period = this.workerOptions.jobPollPeriod;
  }

  configure(distributedLockName?: string, jobNameFilter?: BackgroundJobNameFilter): void {
    this.distributedLockName = distributedLockName ?? this.workerOptions.distributedLockName;
    this.jobNameFilter = jobNameFilter ?? BackgroundJobNameFilter.None;
  }

  protected override async doWork(workerContext: PeriodicBackgroundWorkerContext): Promise<void> {
    if (this.workerOptions.maxParallelJobExecutionCount > 1) await this.executeJobsInParallel(workerContext);
    else await this.executeJobsWithWorkerLock(workerContext);
  }

  protected async executeJobsWithWorkerLock(workerContext: PeriodicBackgroundWorkerContext): Promise<void> {
    await using handle = await this.distributedLock.tryAcquire(this.distributedLockName, 0, this.stoppingSignal);
    if (handle !== undefined) await this.executeWaitingJobs(workerContext);
    else await this.waitForNextTry();
  }

  protected async executeWaitingJobs(workerContext: PeriodicBackgroundWorkerContext): Promise<void> {
    const store = workerContext.serviceProvider.getRequired(IBackgroundJobStore);
    const waitingJobs = await this.getWaitingJobs(workerContext, store);
    if (waitingJobs.length === 0) return;

    const jobExecuter = workerContext.serviceProvider.getRequired(IBackgroundJobExecuter);
    const clock = workerContext.serviceProvider.getRequired(IClock);
    const serializer = workerContext.serviceProvider.getRequired(IBackgroundJobSerializer);
    for (const jobInfo of waitingJobs) {
      if (workerContext.signal.aborted) return;
      await this.tryExecuteJob(workerContext, store, jobInfo, jobExecuter, clock, serializer);
    }
  }

  /** Executes up to `maxParallelJobExecutionCount` waiting jobs concurrently, each claimed with its own lock. */
  protected async executeJobsInParallel(workerContext: PeriodicBackgroundWorkerContext): Promise<void> {
    const store = workerContext.serviceProvider.getRequired(IBackgroundJobStore);
    const waitingJobs = await this.getWaitingJobs(workerContext, store);
    if (waitingJobs.length === 0) return;

    const runningTasks: Promise<void>[] = [];
    try {
      for (const jobInfo of waitingJobs) {
        if (runningTasks.length >= this.workerOptions.maxParallelJobExecutionCount || workerContext.signal.aborted) break;
        const handle = await this.distributedLock.tryAcquire(this.getPerJobDistributedLockName(jobInfo), 0, this.stoppingSignal);
        if (handle === undefined) continue;
        runningTasks.push(this.executeClaimedJob(jobInfo, handle, workerContext.signal));
      }
    } finally {
      await Promise.all(runningTasks);
    }
  }

  protected async executeClaimedJob(jobInfo: BackgroundJobInfo, handle: IAbpDistributedLockHandle, signal: AbortSignal): Promise<void> {
    await using _lock = handle;
    await using scope = this.serviceScopeFactory.createScope();
    try {
      const workerContext = new PeriodicBackgroundWorkerContext(scope.serviceProvider, signal);
      const store = scope.serviceProvider.getRequired(IBackgroundJobStore);
      const clock = scope.serviceProvider.getRequired(IClock);
      const currentJobInfo = await store.find(jobInfo.id);
      if (!this.isJobEligible(currentJobInfo, clock)) return;

      const jobExecuter = scope.serviceProvider.getRequired(IBackgroundJobExecuter);
      const serializer = scope.serviceProvider.getRequired(IBackgroundJobSerializer);
      await this.tryExecuteJob(workerContext, store, currentJobInfo!, jobExecuter, clock, serializer);
    } catch (e) {
      await scope.serviceProvider.getRequired(IExceptionNotifier).notify(new ExceptionNotificationContext(e));
      this.logger.logException(e);
    }
  }

  protected isJobEligible(jobInfo: BackgroundJobInfo | undefined, clock: IClock): boolean {
    return (
      jobInfo !== undefined &&
      jobInfo.applicationName === this.workerOptions.applicationName &&
      !jobInfo.isAbandoned &&
      jobInfo.completionTime === undefined &&
      jobInfo.nextTryTime.getTime() <= clock.now.getTime() &&
      this.jobNameFilter.isMatch(jobInfo.jobName)
    );
  }

  protected getPerJobDistributedLockName(jobInfo: BackgroundJobInfo): string {
    return this.workerOptions.perJobDistributedLockPrefix + jobInfo.id;
  }

  protected getWaitingJobs(_workerContext: PeriodicBackgroundWorkerContext, store: IBackgroundJobStore): Promise<BackgroundJobInfo[]> {
    return store.getWaitingJobs(this.workerOptions.applicationName, this.workerOptions.maxJobFetchCount, this.jobNameFilter);
  }

  protected async tryExecuteJob(workerContext: PeriodicBackgroundWorkerContext, store: IBackgroundJobStore, jobInfo: BackgroundJobInfo, jobExecuter: IBackgroundJobExecuter, clock: IClock, serializer: IBackgroundJobSerializer): Promise<void> {
    jobInfo.tryCount++;
    jobInfo.lastTryTime = clock.now;

    try {
      const jobConfiguration = this.jobOptions.getJob(jobInfo.jobName);
      const jobArgs = serializer.deserialize<object>(jobInfo.jobArgs, jobConfiguration.argsType);
      const context = new JobExecutionContext(workerContext.serviceProvider, jobConfiguration.jobType, jobArgs, workerContext.signal);
      try {
        await jobExecuter.execute(context);
        await this.handleJobSuccess(store, jobInfo, clock);
      } catch (e) {
        if (!(e instanceof BackgroundJobExecutionException)) throw e;
        await this.handleJobFailure(store, jobInfo, clock);
      }
    } catch (e) {
      await this.handleJobError(store, jobInfo, e);
    }
  }

  protected async handleJobSuccess(store: IBackgroundJobStore, jobInfo: BackgroundJobInfo, clock: IClock): Promise<void> {
    if (this.workerOptions.storeSuccessfulJobs) {
      jobInfo.completionTime = clock.now;
      await store.update(jobInfo);
    } else {
      await store.delete(jobInfo.id);
    }
  }

  protected async handleJobFailure(store: IBackgroundJobStore, jobInfo: BackgroundJobInfo, clock: IClock): Promise<void> {
    const nextTryTime = this.calculateNextTryTime(jobInfo, clock);
    if (nextTryTime !== undefined) jobInfo.nextTryTime = nextTryTime;
    else jobInfo.isAbandoned = true;
    await this.tryUpdate(store, jobInfo);
  }

  protected async handleJobError(store: IBackgroundJobStore, jobInfo: BackgroundJobInfo, e: unknown): Promise<void> {
    this.logger.logException(e);
    jobInfo.isAbandoned = true;
    await this.tryUpdate(store, jobInfo);
  }

  /** .NET blocks the poll loop for 12 poll periods when another instance holds the lock; a `runOnce()` tick returns at once. */
  protected async waitForNextTry(): Promise<void> {
    if (!this.isRunning || this.isOnDemandRun) return;
    try {
      await delay(this.workerOptions.jobPollPeriod * 12, this.stoppingSignal);
    } catch {
      // stopped while waiting
    }
  }

  protected async tryUpdate(store: IBackgroundJobStore, jobInfo: BackgroundJobInfo): Promise<void> {
    try {
      await store.update(jobInfo);
    } catch (updateError) {
      this.logger.logException(updateError);
    }
  }

  protected calculateNextTryTime(jobInfo: BackgroundJobInfo, clock: IClock): Date | undefined {
    const nextWaitDurationMs = this.workerOptions.defaultFirstWaitDuration * Math.pow(this.workerOptions.defaultWaitFactor, jobInfo.tryCount - 1) * 1000;
    const nextTryDate = new Date((jobInfo.lastTryTime ?? clock.now).getTime() + nextWaitDurationMs);
    if ((nextTryDate.getTime() - jobInfo.creationTime.getTime()) / 1000 > this.workerOptions.defaultTimeout) return undefined;
    return nextTryDate;
  }
}
