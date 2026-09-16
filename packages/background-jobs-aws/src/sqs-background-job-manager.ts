import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { AbpException, Dependency, Guid, ILoggerFactory, Transient, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { AbpBackgroundJobOptions, BackgroundJob, BackgroundJobPriority, IBackgroundJobManager, IBackgroundJobSerializer, type JobArgsOrJobType } from "@abp/background-jobs";
import { ICurrentTenant, isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { AbpSqsBackgroundJobOptions } from "./abp-sqs-background-job-options.js";
import { ISqsClientFactory } from "./sqs-client-factory.js";
import type { SqsJobMessage } from "./sqs-job-message.js";

/**
 * `IBackgroundJobManager` on SQS (the Hangfire/Quartz/RabbitMQ provider role): `enqueue` sends one message per job
 * to the jobs queue; the jobs Lambda (`createSqsJobsHandler`) executes it through `IBackgroundJobExecuter`.
 */
@Dependency({ replaceServices: true })
@Transient(IBackgroundJobManager)
export class SqsBackgroundJobManager implements IBackgroundJobManager {
  static readonly inject = [optionsToken(AbpBackgroundJobOptions), optionsToken(AbpSqsBackgroundJobOptions), IBackgroundJobSerializer, ICurrentTenant, ISqsClientFactory, ILoggerFactory] as const;
  protected readonly backgroundJobOptions: AbpBackgroundJobOptions;
  protected readonly options: AbpSqsBackgroundJobOptions;
  protected readonly logger: ILogger;
  private client: SQSClient | undefined;

  constructor(
    backgroundJobOptions: IOptions<AbpBackgroundJobOptions>,
    options: IOptions<AbpSqsBackgroundJobOptions>,
    protected readonly serializer: IBackgroundJobSerializer,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly clientFactory: ISqsClientFactory,
    loggerFactory: ILoggerFactory,
  ) {
    this.backgroundJobOptions = backgroundJobOptions.value;
    this.options = options.value;
    this.logger = loggerFactory.createLogger(SqsBackgroundJobManager.name);
  }

  async enqueue<TArgs extends object>(argsOrJobType: JobArgsOrJobType<TArgs>, args: TArgs, priority = BackgroundJobPriority.Normal, delayMs?: number): Promise<string> {
    const argsType = BackgroundJob.getArgsTypeOrNull(argsOrJobType) ?? argsOrJobType;
    const jobName = this.backgroundJobOptions.getBackgroundJobName(argsType);
    const message: SqsJobMessage = {
      jobName,
      argsJson: this.serializer.serialize(args),
      tenantId: this.getTenantId(args),
      priority,
      enqueuedAt: new Date().toISOString(),
    };

    const response = await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        DelaySeconds: this.toDelaySeconds(jobName, delayMs),
        MessageAttributes: {
          jobName: { DataType: "String", StringValue: jobName },
          priority: { DataType: "Number", StringValue: String(priority) },
        },
      }),
    );
    return response.MessageId ?? Guid.newGuid();
  }

  protected getTenantId(args: object): string | undefined {
    if (isMultiTenant(args)) return args.tenantId ?? undefined;
    return this.currentTenant.id;
  }

  protected toDelaySeconds(jobName: string, delayMs: number | undefined): number {
    if (delayMs === undefined || delayMs <= 0) return 0;
    const seconds = Math.ceil(delayMs / 1000);
    if (seconds <= this.options.maxDelaySeconds) return seconds;
    this.logger.warn(`The delay of the background job '${jobName}' (${seconds}s) exceeds the SQS maximum; it is capped to ${this.options.maxDelaySeconds}s.`);
    return this.options.maxDelaySeconds;
  }

  protected get queueUrl(): string {
    const url = this.options.queueUrl;
    if (!url) throw new AbpException("AbpSqsBackgroundJobOptions.queueUrl is not configured (set BackgroundJobs:Aws:QueueUrl).");
    return url;
  }

  protected get sqsClient(): SQSClient {
    this.client ??= this.options.createClient?.() ?? this.clientFactory.getClient();
    return this.client;
  }
}
