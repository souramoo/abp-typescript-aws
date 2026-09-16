import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { ILoggerFactory, forkAmbientScope, type IAbpApplication, type ILogger } from "@abp/core";
import { AbpBackgroundJobOptions, IBackgroundJobExecuter } from "@abp/background-jobs";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { parseSqsJobMessage } from "./sqs-job-message.js";

export type SqsJobsHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;

/**
 * Creates the Lambda handler of the jobs queue (`SqsEventSource` with `reportBatchItemFailures`). Each record runs
 * `IBackgroundJobExecuter.executeSerialized` under the tenant carried by the message; a record that throws is
 * reported in `batchItemFailures` so SQS redelivers only that message.
 */
export function createSqsJobsHandler(appFactory: () => Promise<IAbpApplication> | IAbpApplication): SqsJobsHandler {
  let appPromise: Promise<IAbpApplication> | undefined;
  const getApp = () => (appPromise ??= Promise.resolve(appFactory()));

  return async (event) => {
    const app = await getApp();
    const logger = app.serviceProvider.getRequired(ILoggerFactory).createLogger("SqsJobsHandler");
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await processRecord(app, record, logger);
      } catch (e) {
        logger.error(`Background job message ${record.messageId} failed.`, e);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

async function processRecord(app: IAbpApplication, record: SQSRecord, logger: ILogger): Promise<void> {
  const message = parseSqsJobMessage(record.body);
  if (!app.serviceProvider.getOptions(AbpBackgroundJobOptions).isJobExecutionEnabled) {
    logger.warn(`Job execution is disabled; message ${record.messageId} (${message.jobName}) is left on the queue.`);
    throw new Error("Background job execution is disabled (AbpBackgroundJobOptions.isJobExecutionEnabled).");
  }
  await forkAmbientScope(async () => {
    await using scope = app.serviceProvider.createScope();
    const executer = scope.serviceProvider.getRequired(IBackgroundJobExecuter);
    const currentTenant = scope.serviceProvider.getRequired(ICurrentTenant);
    await currentTenant.run(message.tenantId, undefined, () => executer.executeSerialized(message.jobName, message.argsJson));
  });
}
