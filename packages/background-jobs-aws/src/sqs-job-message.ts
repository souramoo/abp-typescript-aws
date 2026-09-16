import { BackgroundJobPriority } from "@abp/background-jobs";

/** The body of a job message on the SQS queue. */
export interface SqsJobMessage {
  jobName: string;
  /** The job args serialized by `IBackgroundJobSerializer`. */
  argsJson: string;
  tenantId?: string;
  priority: BackgroundJobPriority;
  /** ISO 8601 timestamp of the enqueue. */
  enqueuedAt: string;
}

const priorities = new Set<number>(Object.values(BackgroundJobPriority).filter((v): v is number => typeof v === "number"));

/** Hand-written guard for the untrusted queue payload. */
export function parseSqsJobMessage(body: string): SqsJobMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new TypeError(`The SQS job message body is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) throw new TypeError("The SQS job message body must be a JSON object.");
  const record = parsed as Record<string, unknown>;
  if (typeof record["jobName"] !== "string" || record["jobName"] === "") throw new TypeError("The SQS job message has no 'jobName'.");
  if (typeof record["argsJson"] !== "string") throw new TypeError("The SQS job message has no 'argsJson'.");
  if (record["tenantId"] !== undefined && record["tenantId"] !== null && typeof record["tenantId"] !== "string") throw new TypeError("The SQS job message 'tenantId' must be a string.");
  const priority = typeof record["priority"] === "number" && priorities.has(record["priority"]) ? (record["priority"] as BackgroundJobPriority) : BackgroundJobPriority.Normal;
  return {
    jobName: record["jobName"],
    argsJson: record["argsJson"],
    tenantId: typeof record["tenantId"] === "string" ? record["tenantId"] : undefined,
    priority,
    enqueuedAt: typeof record["enqueuedAt"] === "string" ? record["enqueuedAt"] : new Date(0).toISOString(),
  };
}
