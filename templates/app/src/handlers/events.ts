import { createSqsEventsHandler } from "@abp/event-bus-aws";
import { createHostApplication } from "../application.js";

/** SQS events queue consumer (SNS subscription): dispatches distributed events to their handlers (or the inbox). */
export const handler = createSqsEventsHandler(() => createHostApplication());
