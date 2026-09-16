import {
  AbpException,
  ExceptionNotificationContext,
  ICancellationTokenProvider,
  IExceptionNotifier,
  ILoggerFactory,
  IRootServiceProvider,
  Transient,
  createToken,
  forkAmbientScope,
  optionsToken,
  type Class,
  type Guid,
  type ILogger,
  type IOptions,
  type IServiceProvider,
  type IServiceProviderAccessor,
} from "@abp/core";
import { ICurrentTenant, isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { AbpBackgroundJobOptions } from "./abp-background-job-options.js";
import { IBackgroundJobSerializer } from "./background-job-serializer.js";
import type { IBackgroundJob } from "./background-job.js";

/** Port of `JobExecutionContext`. */
export class JobExecutionContext implements IServiceProviderAccessor {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly jobType: Class,
    readonly jobArgs: object,
    readonly signal: AbortSignal | undefined = undefined,
  ) {}
}

/** Port of `BackgroundJobExecutionException`. */
export class BackgroundJobExecutionException extends AbpException {
  jobType: string;
  jobArgs: unknown;

  constructor(message: string, init: { cause?: unknown; jobType?: string; jobArgs?: unknown } = {}) {
    super(message, { cause: init.cause });
    this.jobType = init.jobType ?? "";
    this.jobArgs = init.jobArgs;
  }
}

/** Port of `IBackgroundJobExecuter` (+ `executeSerialized`, the seam for queue consumers). */
export interface IBackgroundJobExecuter {
  execute(context: JobExecutionContext): Promise<void>;
  /**
   * Executes the job registered under `jobName` with its serialized (JSON) args in a fresh service scope.
   * The SQS consumer of `@abp/background-jobs-aws` calls this for each message.
   */
  executeSerialized(jobName: string, argsJson: string, signal?: AbortSignal): Promise<void>;
}
export const IBackgroundJobExecuter = createToken<IBackgroundJobExecuter>("IBackgroundJobExecuter");

/** Port of `BackgroundJobExecuter`. */
@Transient(IBackgroundJobExecuter)
export class BackgroundJobExecuter implements IBackgroundJobExecuter {
  static readonly inject = [optionsToken(AbpBackgroundJobOptions), ICurrentTenant, ILoggerFactory, IRootServiceProvider, IBackgroundJobSerializer] as const;
  protected readonly options: AbpBackgroundJobOptions;
  protected readonly logger: ILogger;

  constructor(
    options: IOptions<AbpBackgroundJobOptions>,
    protected readonly currentTenant: ICurrentTenant,
    loggerFactory: ILoggerFactory,
    protected readonly rootServiceProvider: IServiceProvider,
    protected readonly serializer: IBackgroundJobSerializer,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(BackgroundJobExecuter.name);
  }

  async execute(context: JobExecutionContext): Promise<void> {
    const job = context.serviceProvider.get(context.jobType) as Partial<IBackgroundJob<object>> | undefined;
    if (job === undefined) throw new AbpException(`The job type is not registered to DI: ${context.jobType.name}`);
    if (typeof job.execute !== "function") {
      throw new AbpException(`Given job type does not implement IBackgroundJob (an 'execute(args)' method). The job type was: ${context.jobType.name}`);
    }

    try {
      await this.currentTenant.run(this.getJobArgsTenantId(context.jobArgs), undefined, async () => {
        const cancellationTokenProvider = context.serviceProvider.getRequired(ICancellationTokenProvider);
        using _cancellation = cancellationTokenProvider.use(context.signal);
        await job.execute!(context.jobArgs);
      });
    } catch (e) {
      this.logger.logException(e);
      await context.serviceProvider.getRequired(IExceptionNotifier).notify(new ExceptionNotificationContext(e));
      throw new BackgroundJobExecutionException("A background job execution is failed. See inner exception for details.", { cause: e, jobType: context.jobType.name, jobArgs: context.jobArgs });
    }
  }

  async executeSerialized(jobName: string, argsJson: string, signal?: AbortSignal): Promise<void> {
    const configuration = this.options.getJob(jobName);
    const jobArgs = this.serializer.deserialize<object>(argsJson, configuration.argsType);
    await forkAmbientScope(async () => {
      await using scope = this.rootServiceProvider.createScope();
      await this.execute(new JobExecutionContext(scope.serviceProvider, configuration.jobType, jobArgs, signal));
    });
  }

  protected getJobArgsTenantId(jobArgs: object): Guid | undefined {
    if (isMultiTenant(jobArgs)) return jobArgs.tenantId ?? undefined;
    return this.currentTenant.id;
  }
}
