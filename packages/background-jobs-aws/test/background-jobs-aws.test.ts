import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Transient } from "@abp/core";
import { AbpBackgroundJobOptions, AsyncBackgroundJob, BackgroundJob, BackgroundJobName, BackgroundJobPriority, IBackgroundJobManager, NullBackgroundJobManager } from "@abp/background-jobs";
import { ICurrentTenant, type IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { AbpBackgroundJobsAwsModule, AbpSqsBackgroundJobOptions, SqsBackgroundJobManager, createSqsJobsHandler, parseSqsJobMessage } from "../src/index.js";

const sqsMock = mockClient(SQSClient);
const tenantId = "11111111-1111-4111-8111-111111111111";

@BackgroundJobName("SendEmail")
class EmailArgs {
  constructor(
    public to: string,
    public subject: string,
  ) {}
}

class ReportArgs implements IMultiTenant {
  constructor(
    public name: string,
    public tenantId: string | null = null,
  ) {}
}

@Transient()
@BackgroundJob(EmailArgs)
class SendEmailJob extends AsyncBackgroundJob<EmailArgs> {
  static readonly executed: string[] = [];
  static failFor: string | undefined;
  async execute(args: EmailArgs): Promise<void> {
    if (args.to === SendEmailJob.failFor) throw new Error(`cannot send to ${args.to}`);
    SendEmailJob.executed.push(`${args.subject} -> ${args.to}`);
  }
}

@Transient()
@BackgroundJob(ReportArgs)
class ReportJob extends AsyncBackgroundJob<ReportArgs> {
  static readonly inject = [ICurrentTenant] as const;
  static readonly seenTenants: (string | undefined)[] = [];
  constructor(private readonly currentTenant: ICurrentTenant) {
    super();
  }
  async execute(): Promise<void> {
    ReportJob.seenTenants.push(this.currentTenant.id);
  }
}

@DependsOn(AbpBackgroundJobsAwsModule)
class TestModule extends AbpModule {
  static executionEnabled = true;
  override configureServices(): void {
    this.configure(AbpBackgroundJobOptions, (o) => {
      o.isJobExecutionEnabled = TestModule.executionEnabled;
    });
  }
}

async function createApp(values: Record<string, unknown> = { BackgroundJobs: { Aws: { QueueUrl: "https://sqs.local/jobs" } } }) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

function sqsRecord(messageId: string, body: unknown): SQSRecord {
  return { messageId, receiptHandle: "r", body: typeof body === "string" ? body : JSON.stringify(body), attributes: {}, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn", awsRegion: "eu-west-1" } as SQSRecord;
}

describe("SQS background jobs", () => {
  beforeEach(() => {
    sqsMock.reset();
    SendEmailJob.executed.length = 0;
    SendEmailJob.failFor = undefined;
    ReportJob.seenTenants.length = 0;
    TestModule.executionEnabled = true;
  });

  it("replaces the null manager and reads the queue url from the configuration", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    expect(manager).toBeInstanceOf(SqsBackgroundJobManager);
    expect(manager).not.toBeInstanceOf(NullBackgroundJobManager);
    expect(app.serviceProvider.getOptions(AbpSqsBackgroundJobOptions).queueUrl).toBe("https://sqs.local/jobs");
  });

  it("enqueues a job as an SQS message with the serialized args, tenant, priority and capped delay", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundJobManager);
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "m-1" });

    const id = await app.serviceProvider.getRequired(ICurrentTenant).run(tenantId, undefined, () => manager.enqueue(EmailArgs, new EmailArgs("a@b.c", "Hi"), BackgroundJobPriority.High, 2500));
    expect(id).toBe("m-1");
    const input = sqsMock.commandCalls(SendMessageCommand)[0]!.args[0].input;
    expect(input.QueueUrl).toBe("https://sqs.local/jobs");
    expect(input.DelaySeconds).toBe(3);
    expect(input.MessageAttributes?.["jobName"]).toEqual({ DataType: "String", StringValue: "SendEmail" });
    const body = parseSqsJobMessage(input.MessageBody!);
    expect(body).toMatchObject({ jobName: "SendEmail", tenantId, priority: BackgroundJobPriority.High });
    expect(JSON.parse(body.argsJson)).toEqual({ to: "a@b.c", subject: "Hi" });

    await manager.enqueue(SendEmailJob, new EmailArgs("x", "y"), undefined, 100 * 60 * 1000);
    expect(sqsMock.commandCalls(SendMessageCommand)[1]!.args[0].input.DelaySeconds).toBe(900);

    await manager.enqueue(ReportArgs, new ReportArgs("r", tenantId));
    expect(parseSqsJobMessage(sqsMock.commandCalls(SendMessageCommand)[2]!.args[0].input.MessageBody!).tenantId).toBe(tenantId);
  });

  it("fails clearly when the queue url is missing", async () => {
    const app = await createApp({});
    await expect(app.serviceProvider.getRequired(IBackgroundJobManager).enqueue(EmailArgs, new EmailArgs("a", "b"))).rejects.toThrow("queueUrl is not configured");
  });

  it("executes queued jobs from SQS records under their tenant and reports failed records", async () => {
    const app = await createApp();
    const handler = createSqsJobsHandler(() => app);
    const event: SQSEvent = {
      Records: [
        sqsRecord("ok", { jobName: "SendEmail", argsJson: JSON.stringify({ to: "a@b.c", subject: "Hi" }), priority: 15, enqueuedAt: new Date().toISOString() }),
        sqsRecord("fail", { jobName: "SendEmail", argsJson: JSON.stringify({ to: "bad@b.c", subject: "Hi" }), priority: 15, enqueuedAt: new Date().toISOString() }),
        sqsRecord("tenant", { jobName: "ReportArgs", argsJson: JSON.stringify({ name: "r" }), tenantId, priority: 15, enqueuedAt: new Date().toISOString() }),
        sqsRecord("host", { jobName: "ReportArgs", argsJson: JSON.stringify({ name: "r" }), priority: 15, enqueuedAt: new Date().toISOString() }),
        sqsRecord("unknown", { jobName: "Nope", argsJson: "{}", priority: 15, enqueuedAt: new Date().toISOString() }),
        sqsRecord("garbage", "not json"),
      ],
    };
    SendEmailJob.failFor = "bad@b.c";

    const response = await handler(event);
    expect(response.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(["fail", "unknown", "garbage"]);
    expect(SendEmailJob.executed).toEqual(["Hi -> a@b.c"]);
    expect(ReportJob.seenTenants).toEqual([tenantId, undefined]);
    expect(app.serviceProvider.getRequired(ICurrentTenant).id).toBeUndefined();
  });

  it("leaves messages on the queue when job execution is disabled", async () => {
    TestModule.executionEnabled = false;
    const app = await createApp();
    const handler = createSqsJobsHandler(async () => app);
    const response = await handler({ Records: [sqsRecord("m", { jobName: "SendEmail", argsJson: JSON.stringify({ to: "a", subject: "b" }) })] });
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "m" }]);
    expect(SendEmailJob.executed).toEqual([]);
  });
});
