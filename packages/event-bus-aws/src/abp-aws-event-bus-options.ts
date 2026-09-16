import type { SNSClient } from "@aws-sdk/client-sns";

/** Options of the SNS/SQS distributed event bus (configuration section `EventBus:Aws`). */
export class AbpAwsEventBusOptions {
  /** ARN of the events topic (`EventBus:Aws:TopicArn`, `ABP__EventBus__Aws__TopicArn`). */
  topicArn: string | undefined;
  /** URL of this service's subscription queue (`EventBus:Aws:QueueUrl`); informational for the Lambda event source. */
  queueUrl: string | undefined;
  /** Overrides the lazily created `SNSClient`. */
  createSnsClient: (() => SNSClient) | undefined;
}
