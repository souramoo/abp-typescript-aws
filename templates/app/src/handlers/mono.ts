import { createApiGatewayHandler, createMonoLambdaHandler, queueNameOf } from "@abp/aws-lambda";
import { createSqsJobsHandler } from "@abp/background-jobs-aws";
import { createSqsEventsHandler } from "@abp/event-bus-aws";
import { createHostApplication } from "../application.js";
import { runWorkersOnce } from "./workers.js";

/**
 * Mono-lambda entry point (the default deployment): ONE function serves every HTTP route, consumes the jobs and
 * events queues and runs the scheduled workers, autoscaling with API Gateway / SQS concurrency. The split
 * deployment (`api.ts`, `jobs.ts`, `events.ts`, `workers.ts`) remains available for per-workload tuning.
 *
 * Queue routing is by queue name so the same bundle works in every stage: the names are derived from the queue
 * URLs the stack injects (`ABP__BackgroundJobs__Aws__QueueUrl`, `ABP__EventBus__Aws__QueueUrl`).
 */
const app = () => createHostApplication();
const jobsQueue = queueNameOf(process.env["ABP__BackgroundJobs__Aws__QueueUrl"]) || "jobs";
const eventsQueue = queueNameOf(process.env["ABP__EventBus__Aws__QueueUrl"]) || "events";

export const handler = createMonoLambdaHandler({
  http: createApiGatewayHandler(app),
  sqs: {
    [jobsQueue]: createSqsJobsHandler(app),
    [eventsQueue]: createSqsEventsHandler(app),
  },
  scheduled: () => runWorkersOnce(),
  invoke: {
    workers: () => runWorkersOnce(),
  },
});
