import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context as LambdaContext, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { AbpException } from "@abp/core";

/**
 * Mono-lambda hosting: one Lambda function serves every HTTP route and consumes every queue and schedule of the
 * application, scaling with API Gateway and SQS concurrency. This is the serverless equivalent of ABP's single
 * `*.HttpApi.Host` process. The dispatcher looks at the shape of the incoming event and routes it to the matching
 * handler; each handler shares the container-cached `AbpApplication`.
 */
export type SqsHandler = (event: SQSEvent, context?: LambdaContext) => Promise<SQSBatchResponse | void>;
export type ScheduledHandler = (event: ScheduledEventLike, context?: LambdaContext) => Promise<unknown>;
export type DirectInvokeHandler = (event: DirectInvokeEvent, context?: LambdaContext) => Promise<unknown>;
export type HttpEventHandler = (event: APIGatewayProxyEventV2, context?: LambdaContext) => Promise<APIGatewayProxyStructuredResultV2>;

/** EventBridge scheduled event (`aws.events` / "Scheduled Event") or an EventBridge Scheduler payload. */
export interface ScheduledEventLike {
  source?: string;
  "detail-type"?: string;
  detail?: unknown;
  resources?: string[];
}

/** Direct `lambda:Invoke` payload: `{ "abp": "<task>", ... }` (e.g. `{ abp: "workers" }` from a scheduler or a CLI). */
export interface DirectInvokeEvent {
  abp: string;
  [key: string]: unknown;
}

export interface MonoLambdaHandlers {
  /** API Gateway HTTP API v2 / Function URL events. */
  http?: HttpEventHandler;
  /**
   * SQS event sources keyed by queue name (the last segment of the queue URL or ARN), or `"*"` as a catch-all.
   * A single SQS batch always comes from one queue, so the first record decides.
   */
  sqs?: Record<string, SqsHandler>;
  /** EventBridge schedule (rate/cron rules) events. */
  scheduled?: ScheduledHandler;
  /** Direct invocations keyed by the `abp` task name, or `"*"` as a catch-all. */
  invoke?: Record<string, DirectInvokeHandler>;
}

export type MonoLambdaEvent = APIGatewayProxyEventV2 | SQSEvent | ScheduledEventLike | DirectInvokeEvent;
export type MonoLambdaHandler = (event: MonoLambdaEvent, context?: LambdaContext) => Promise<unknown>;

export type MonoLambdaEventKind =
  | { kind: "http"; event: APIGatewayProxyEventV2 }
  | { kind: "sqs"; event: SQSEvent; queueName: string }
  | { kind: "scheduled"; event: ScheduledEventLike }
  | { kind: "invoke"; event: DirectInvokeEvent }
  | { kind: "unknown"; event: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isApiGatewayV2Event(event: unknown): event is APIGatewayProxyEventV2 {
  if (!isRecord(event)) return false;
  const requestContext = event["requestContext"];
  return typeof event["rawPath"] === "string" && isRecord(requestContext) && isRecord(requestContext["http"]);
}

export function isSqsEvent(event: unknown): event is SQSEvent {
  if (!isRecord(event)) return false;
  const records = event["Records"];
  if (!Array.isArray(records) || records.length === 0) return false;
  const first: unknown = records[0];
  return isRecord(first) && first["eventSource"] === "aws:sqs";
}

export function isScheduledEvent(event: unknown): event is ScheduledEventLike {
  if (!isRecord(event)) return false;
  if (event["source"] === "aws.events" || event["source"] === "aws.scheduler") return true;
  return event["detail-type"] === "Scheduled Event";
}

export function isDirectInvokeEvent(event: unknown): event is DirectInvokeEvent {
  return isRecord(event) && typeof event["abp"] === "string";
}

/** `arn:aws:sqs:eu-west-2:123:my-queue` or `https://sqs.eu-west-2.amazonaws.com/123/my-queue` → `my-queue`. */
export function queueNameOf(urlOrArn: string | undefined): string {
  if (!urlOrArn) return "";
  const trimmed = urlOrArn.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  const lastColon = trimmed.lastIndexOf(":");
  return trimmed.slice(Math.max(lastSlash, lastColon) + 1);
}

export function classifyMonoLambdaEvent(event: unknown): MonoLambdaEventKind {
  if (isApiGatewayV2Event(event)) return { kind: "http", event };
  if (isSqsEvent(event)) return { kind: "sqs", event, queueName: queueNameOf(event.Records[0]?.eventSourceARN) };
  if (isDirectInvokeEvent(event)) return { kind: "invoke", event };
  if (isScheduledEvent(event)) return { kind: "scheduled", event };
  return { kind: "unknown", event };
}

/**
 * Builds the single entry point of a mono-lambda deployment.
 *
 * ```ts
 * export const handler = createMonoLambdaHandler({
 *   http: createApiGatewayHandler(app),
 *   sqs: { [queueNameOf(jobsQueueUrl)]: createSqsJobsHandler(app), [queueNameOf(eventsQueueUrl)]: createSqsEventsHandler(app) },
 *   scheduled: () => runWorkersOnce(),
 *   invoke: { workers: () => runWorkersOnce() },
 * });
 * ```
 */
export function createMonoLambdaHandler(handlers: MonoLambdaHandlers): MonoLambdaHandler {
  return async (event, context) => {
    const classified = classifyMonoLambdaEvent(event);
    switch (classified.kind) {
      case "http": {
        if (!handlers.http) throw new AbpException("Mono-lambda: received an HTTP event but no `http` handler is configured.");
        return handlers.http(classified.event, context);
      }
      case "sqs": {
        const handler = handlers.sqs?.[classified.queueName] ?? handlers.sqs?.["*"];
        if (!handler) throw new AbpException(`Mono-lambda: no SQS handler is configured for queue '${classified.queueName}'.`);
        return (await handler(classified.event, context)) ?? { batchItemFailures: [] };
      }
      case "scheduled": {
        if (!handlers.scheduled) throw new AbpException("Mono-lambda: received a scheduled event but no `scheduled` handler is configured.");
        return handlers.scheduled(classified.event, context);
      }
      case "invoke": {
        const handler = handlers.invoke?.[classified.event.abp] ?? handlers.invoke?.["*"];
        if (!handler) throw new AbpException(`Mono-lambda: no invoke handler is configured for task '${classified.event.abp}'.`);
        return handler(classified.event, context);
      }
      case "unknown":
        throw new AbpException("Mono-lambda: unrecognised event shape (expected API Gateway v2, SQS, EventBridge schedule or `{ abp: ... }`).");
      default: {
        const _exhaustive: never = classified;
        throw new AbpException(String(_exhaustive));
      }
    }
  };
}
