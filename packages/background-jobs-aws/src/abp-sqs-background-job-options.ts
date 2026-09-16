import type { SQSClient } from "@aws-sdk/client-sqs";

/** Options of the SQS background job manager (configuration section `BackgroundJobs:Aws`). */
export class AbpSqsBackgroundJobOptions {
  /** URL of the jobs queue; defaults to `BackgroundJobs:Aws:QueueUrl` (`ABP__BackgroundJobs__Aws__QueueUrl`). */
  queueUrl: string | undefined;
  /**
   * SQS delays a message for at most 900 seconds; a longer `delayMs` is capped to this value and logged. Jobs that
   * must wait longer should re-enqueue themselves with the remaining delay.
   */
  maxDelaySeconds = 900;
  /** Overrides the lazily created `SQSClient` (tests, custom endpoints). */
  createClient: (() => SQSClient) | undefined;
}
