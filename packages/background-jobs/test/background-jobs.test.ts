import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbpApplication, AbpExceptionHandlingOptions, AbpModule, DependsOn, ExceptionSubscriber, NullLoggerFactory, Transient, type ExceptionNotificationContext } from "@abp/core";
import { AbpBackgroundWorkerOptions, IBackgroundWorkerManager } from "@abp/background-workers";
import { IAbpDistributedLock } from "@abp/distributed-locking";
import { ICurrentTenant, type IMultiTenant } from "@abp/multi-tenancy-abstractions";
import type {
  BackgroundJobWorker,
  InMemoryBackgroundJobStore} from "../src/index.js";
import {
  AbpBackgroundJobOptions,
  AbpBackgroundJobWorkerOptions,
  AbpBackgroundJobsAbstractionsModule,
  AbpBackgroundJobsModule,
  AsyncBackgroundJob,
  BackgroundJob,
  BackgroundJobArgsHelper,
  BackgroundJobExecutionException,
  BackgroundJobName,
  BackgroundJobNameAttribute,
  BackgroundJobPriority,
  BackgroundJobWorkerManager,
  DefaultBackgroundJobManager,
  IBackgroundJobExecuter,
  IBackgroundJobManager,
  IBackgroundJobStore,
  NullBackgroundJobManager,
  isBackgroundJobManagerAvailable,
} from "../src/index.js";

@BackgroundJobName("SendEmail")
class EmailArgs {
  constructor(
    public to: string,
    public subject: string,
  ) {}
  get description(): string {
    return `${this.subject} -> ${this.to}`;
  }
}

class ReportArgs implements IMultiTenant {
  constructor(
    public name: string,
    public tenantId: string | null = null,
  ) {}
}

class FailingArgs {
  constructor(public failTimes: number) {}
}

@Transient()
@BackgroundJob(EmailArgs)
class SendEmailJob extends AsyncBackgroundJob<EmailArgs> {
  static readonly executed: string[] = [];
  async execute(args: EmailArgs): Promise<void> {
    SendEmailJob.executed.push(args.description);
  }
}

@Transient()
class ReportJob extends AsyncBackgroundJob<ReportArgs> {
  static readonly argsType = ReportArgs;
  static readonly inject = [ICurrentTenant] as const;
  static readonly seenTenants: (string | undefined)[] = [];
  constructor(private readonly currentTenant: ICurrentTenant) {
    super();
  }
  async execute(): Promise<void> {
    ReportJob.seenTenants.push(this.currentTenant.id);
  }
}

@Transient()
@BackgroundJob(FailingArgs)
class FailingJob extends AsyncBackgroundJob<FailingArgs> {
  static attempts = 0;
  async execute(args: FailingArgs): Promise<void> {
    FailingJob.attempts++;
    if (FailingJob.attempts <= args.failTimes) throw new Error(`attempt ${FailingJob.attempts} failed`);
  }
}

class RecordingSubscriber extends ExceptionSubscriber {
  static errors: unknown[] = [];
  async handle(context: ExceptionNotificationContext): Promise<void> {
    RecordingSubscriber.errors.push(context.exception);
  }
}

@DependsOn(AbpBackgroundJobsModule)
class TestModule extends AbpModule {
  static configureJobs: ((o: AbpBackgroundJobOptions) => void) | undefined;
  static configureWorker: ((o: AbpBackgroundJobWorkerOptions) => void) | undefined;
  static startWorkers = false;
  override configureServices(): void {
    this.configure(AbpBackgroundWorkerOptions, (o) => {
      o.startWorkersOnInitialization = TestModule.startWorkers;
    });
    this.configure(AbpBackgroundJobOptions, (o) => TestModule.configureJobs?.(o));
    this.configure(AbpBackgroundJobWorkerOptions, (o) => {
      o.defaultFirstWaitDuration = 10;
      o.defaultTimeout = 100;
      TestModule.configureWorker?.(o);
    });
    this.configure(AbpExceptionHandlingOptions, (o) => {
      o.subscribers.add(RecordingSubscriber);
    });
  }
}

@DependsOn(AbpBackgroundJobsAbstractionsModule)
class AbstractionsOnlyModule extends AbpModule {}

async function createApp(configureJobs?: (o: AbpBackgroundJobOptions) => void, configureWorker?: (o: AbpBackgroundJobWorkerOptions) => void, startWorkers = false) {
  TestModule.configureJobs = configureJobs;
  TestModule.configureWorker = configureWorker;
  TestModule.startWorkers = startWorkers;
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance, skipConfigureServices: true });
  app.services.addTransient(RecordingSubscriber);
  await app.configureServices();
  await app.initialize();
  return app;
}

describe("background jobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    SendEmailJob.executed.length = 0;
    ReportJob.seenTenants.length = 0;
    FailingJob.attempts = 0;
    RecordingSubscriber.errors = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueues a job and executes it with deserialized args on the next worker tick", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const store = app.serviceProvider.getRequired(IBackgroundJobStore) as InMemoryBackgroundJobStore;
    expect(manager).toBeInstanceOf(DefaultBackgroundJobManager);
    expect(isBackgroundJobManagerAvailable(manager)).toBe(true);

    const id = await manager.enqueue(EmailArgs, new EmailArgs("a@b.c", "Hi"));
    const info = await store.find(id);
    expect(info?.jobName).toBe("SendEmail");
    expect(info?.jobArgs).toBe('{"to":"a@b.c","subject":"Hi"}');
    expect(info?.priority).toBe(BackgroundJobPriority.Normal);

    await app.serviceProvider.getRequired(IBackgroundWorkerManager).runAllOnce();
    expect(SendEmailJob.executed).toEqual(["Hi -> a@b.c"]);
    expect(store.size).toBe(0);

    await manager.enqueue(SendEmailJob, new EmailArgs("x@y.z", "By job class"), BackgroundJobPriority.High);
    await app.serviceProvider.getRequired(BackgroundJobWorkerManager).runOnce();
    expect(SendEmailJob.executed).toEqual(["Hi -> a@b.c", "By job class -> x@y.z"]);
    await app.shutdown();
  });

  it("polls and executes jobs on the timer when workers are started", async () => {
    const app = await createApp(undefined, undefined, true);
    const workers = app.serviceProvider.getRequired(BackgroundJobWorkerManager);
    expect(workers.activeWorkers).toHaveLength(1);
    expect((workers.activeWorkers[0] as BackgroundJobWorker).isRunning).toBe(true);

    await app.serviceProvider.getRequired(IBackgroundJobManager).enqueue(EmailArgs, new EmailArgs("timer", "tick"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(SendEmailJob.executed).toEqual(["tick -> timer"]);
    await app.shutdown();
    expect(workers.activeWorkers).toHaveLength(0);
  });

  it("honours delay and priority ordering", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const workers = app.serviceProvider.getRequired(BackgroundJobWorkerManager);

    await manager.enqueue(EmailArgs, new EmailArgs("later", "delayed"), BackgroundJobPriority.High, 5000);
    await manager.enqueue(EmailArgs, new EmailArgs("low", "low"), BackgroundJobPriority.Low);
    await manager.enqueue(EmailArgs, new EmailArgs("high", "high"), BackgroundJobPriority.High);
    await workers.runOnce();
    expect(SendEmailJob.executed).toEqual(["high -> high", "low -> low"]);

    vi.advanceTimersByTime(5000);
    await workers.runOnce();
    expect(SendEmailJob.executed).toEqual(["high -> high", "low -> low", "delayed -> later"]);
    await app.shutdown();
  });

  it("retries failed jobs with exponential backoff and abandons them after the timeout", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const store = app.serviceProvider.getRequired(IBackgroundJobStore) as InMemoryBackgroundJobStore;
    const workers = app.serviceProvider.getRequired(BackgroundJobWorkerManager);

    const id = await manager.enqueue(FailingArgs, new FailingArgs(2));
    await workers.runOnce();
    let info = (await store.find(id))!;
    expect(FailingJob.attempts).toBe(1);
    expect(info.tryCount).toBe(1);
    expect(info.nextTryTime.getTime() - info.lastTryTime!.getTime()).toBe(10_000);
    expect(RecordingSubscriber.errors).toHaveLength(1);

    await workers.runOnce();
    expect(FailingJob.attempts).toBe(1);

    vi.advanceTimersByTime(10_000);
    await workers.runOnce();
    info = (await store.find(id))!;
    expect(FailingJob.attempts).toBe(2);
    expect(info.tryCount).toBe(2);
    expect(info.nextTryTime.getTime() - info.lastTryTime!.getTime()).toBe(20_000);

    vi.advanceTimersByTime(20_000);
    await workers.runOnce();
    expect(FailingJob.attempts).toBe(3);
    expect(await store.find(id)).toBeUndefined();

    FailingJob.attempts = 0;
    const abandoned = await manager.enqueue(FailingArgs, new FailingArgs(100));
    for (const wait of [10_000, 20_000, 40_000]) {
      await workers.runOnce();
      vi.advanceTimersByTime(wait);
    }
    await workers.runOnce();
    expect(FailingJob.attempts).toBe(4);
    expect(await store.find(abandoned)).toBeUndefined();
    await app.shutdown();
  });

  it("does not execute jobs when execution is disabled; only the abstractions give the null manager", async () => {
    const app = await createApp((o) => {
      o.isJobExecutionEnabled = false;
    });
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const store = app.serviceProvider.getRequired(IBackgroundJobStore) as InMemoryBackgroundJobStore;
    await manager.enqueue(EmailArgs, new EmailArgs("a", "b"));
    await app.serviceProvider.getRequired(IBackgroundWorkerManager).runAllOnce();
    await app.serviceProvider.getRequired(BackgroundJobWorkerManager).start();
    expect(app.serviceProvider.getRequired(BackgroundJobWorkerManager).activeWorkers).toHaveLength(0);
    expect(SendEmailJob.executed).toEqual([]);
    expect(store.size).toBe(1);
    await app.shutdown();

    const abstractionsApp = await AbpApplication.create(AbstractionsOnlyModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance });
    await abstractionsApp.initialize();
    const nullManager = abstractionsApp.serviceProvider.getRequired(IBackgroundJobManager);
    expect(nullManager).toBeInstanceOf(NullBackgroundJobManager);
    expect(isBackgroundJobManagerAvailable(nullManager)).toBe(false);
    await expect(nullManager.enqueue(EmailArgs, new EmailArgs("a", "b"))).rejects.toThrow("has not a real implementation");
    await abstractionsApp.shutdown();
  });

  it("maps job names, args types and job types", async () => {
    const app = await createApp();
    const options = app.serviceProvider.getOptions(AbpBackgroundJobOptions);
    expect(BackgroundJobNameAttribute.getName(EmailArgs)).toBe("SendEmail");
    expect(BackgroundJobNameAttribute.getName(ReportArgs)).toBe("ReportArgs");
    expect(BackgroundJobArgsHelper.getJobArgsType(SendEmailJob)).toBe(EmailArgs);
    expect(BackgroundJobArgsHelper.getJobArgsType(ReportJob)).toBe(ReportArgs);
    expect(() => BackgroundJobArgsHelper.getJobArgsType(class NotAJob {})).toThrow("Could not find type of the job args");

    expect(options.getJob("SendEmail").jobType).toBe(SendEmailJob);
    expect(options.getJob(EmailArgs).jobName).toBe("SendEmail");
    expect(options.getJob("ReportArgs").argsType).toBe(ReportArgs);
    expect(options.getJobOrNull("nope")).toBeUndefined();
    expect(() => options.getJob("nope")).toThrow("Undefined background job for the job name: nope");
    expect(options.jobConfigurations.map((c) => c.jobName).sort()).toEqual(["FailingArgs", "ReportArgs", "SendEmail"]);
    await app.shutdown();
  });

  it("executeSerialized runs a job by name from JSON (queue consumer seam) and wraps failures", async () => {
    const app = await createApp();
    const executer = app.serviceProvider.getRequired(IBackgroundJobExecuter);
    await executer.executeSerialized("SendEmail", '{"to":"q@sqs","subject":"From queue"}');
    expect(SendEmailJob.executed).toEqual(["From queue -> q@sqs"]);

    await expect(executer.executeSerialized("FailingArgs", '{"failTimes":5}')).rejects.toBeInstanceOf(BackgroundJobExecutionException);
    expect(RecordingSubscriber.errors).toHaveLength(1);
    await expect(executer.executeSerialized("nope", "{}")).rejects.toThrow("Undefined background job");
    await app.shutdown();
  });

  it("switches to the tenant of IMultiTenant job args", async () => {
    const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const workers = app.serviceProvider.getRequired(BackgroundJobWorkerManager);
    await manager.enqueue(ReportArgs, new ReportArgs("host"));
    await manager.enqueue(ReportArgs, new ReportArgs("tenant", tenant));
    await workers.runOnce();
    expect(ReportJob.seenTenants.sort()).toEqual([tenant, undefined].sort());
    expect(app.serviceProvider.getRequired(ICurrentTenant).id).toBeUndefined();
    await app.shutdown();
  });

  it("skips the tick while another instance holds the worker lock", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);
    await manager.enqueue(EmailArgs, new EmailArgs("a", "b"));

    const handle = await lock.tryAcquire("AbpBackgroundJobWorker");
    await app.serviceProvider.getRequired(BackgroundJobWorkerManager).runOnce();
    expect(SendEmailJob.executed).toEqual([]);
    await handle!.dispose();
    await app.serviceProvider.getRequired(BackgroundJobWorkerManager).runOnce();
    expect(SendEmailJob.executed).toEqual(["b -> a"]);
    await app.shutdown();
  });

  it("creates dedicated workers with include/exclude filters", async () => {
    const app = await createApp(undefined, (o) => {
      o.addDedicatedWorker("emails", EmailArgs);
    });
    const workers = app.serviceProvider.getRequired(BackgroundJobWorkerManager);
    await workers.start();
    const active = workers.activeWorkers as BackgroundJobWorker[];
    expect(active).toHaveLength(2);
    expect(active.map((w) => w["distributedLockName"])).toEqual(["emails", "AbpBackgroundJobWorker"]);
    expect(active[0]!["jobNameFilter"].isMatch("SendEmail")).toBe(true);
    expect(active[1]!["jobNameFilter"].isMatch("SendEmail")).toBe(false);
    expect(active[1]!["jobNameFilter"].isMatch("ReportArgs")).toBe(true);

    const options = new AbpBackgroundJobWorkerOptions();
    options.addDedicatedWorker(EmailArgs, ReportArgs);
    expect(options.workerConfigurations[0]!.lockName).toMatch(/^AbpBackgroundJobDedicatedWorker:[0-9a-f]{32}$/);
    expect(() => options.addDedicatedWorker("again", EmailArgs)).toThrow("already assigned to a dedicated worker");
    expect(() => options.addDedicatedWorker("AbpBackgroundJobWorker", FailingArgs)).toThrow("already used by another background job worker");
    await app.shutdown();
  });

  it("keeps successful jobs when configured and the cleanup worker removes old ones", async () => {
    const app = await createApp(undefined, (o) => {
      o.storeSuccessfulJobs = true;
      o.successfulJobRetentionTime = 60_000;
    });
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    const store = app.serviceProvider.getRequired(IBackgroundJobStore) as InMemoryBackgroundJobStore;
    const workerManager = app.serviceProvider.getRequired(IBackgroundWorkerManager);
    expect(workerManager.workers).toHaveLength(2);

    const id = await manager.enqueue(EmailArgs, new EmailArgs("a", "b"));
    await workerManager.runAllOnce();
    expect((await store.find(id))?.completionTime).toEqual(new Date("2026-01-01T00:00:00Z"));
    await workerManager.runAllOnce();
    expect(SendEmailJob.executed).toHaveLength(1);

    vi.advanceTimersByTime(61_000);
    await workerManager.runAllOnce();
    expect(await store.find(id)).toBeUndefined();
    await app.shutdown();
  });
});
