import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ILoggerFactory, forkAmbientScope, type IAbpApplication } from "@abp/core";
import { AwsDistributedEventBus } from "./aws-distributed-event-bus.js";
import { parseSqsEventRecord } from "./aws-event-message.js";

export type SqsEventsHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;

/**
 * Creates the Lambda handler of the events queue (SNS → SQS subscription, `reportBatchItemFailures`). Each record
 * is handed to `AwsDistributedEventBus.processIncoming`; a record that throws is reported in `batchItemFailures`.
 */
export function createSqsEventsHandler(appFactory: () => Promise<IAbpApplication> | IAbpApplication): SqsEventsHandler {
  let appPromise: Promise<IAbpApplication> | undefined;
  const getApp = () => (appPromise ??= Promise.resolve(appFactory()));

  return async (event) => {
    const app = await getApp();
    const logger = app.serviceProvider.getRequired(ILoggerFactory).createLogger("SqsEventsHandler");
    const eventBus = app.serviceProvider.getRequired(AwsDistributedEventBus);
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        const message = parseSqsEventRecord(record);
        await forkAmbientScope(() => eventBus.processIncoming(message));
      } catch (e) {
        logger.error(`Distributed event message ${record.messageId} failed.`, e);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
