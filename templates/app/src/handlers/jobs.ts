import { createSqsJobsHandler } from "@abp/background-jobs-aws";
import { createHostApplication } from "../application.js";

/** SQS jobs queue consumer: executes `IBackgroundJob` messages enqueued by `IBackgroundJobManager`. */
export const handler = createSqsJobsHandler(() => createHostApplication());
