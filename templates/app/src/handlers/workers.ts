import { forkAmbientScope } from "@abp/core";
import { BackgroundJobWorkerManager } from "@abp/background-jobs";
import { IBackgroundWorkerManager } from "@abp/background-workers";
import { InboxProcessManager, OutboxSenderManager } from "@abp/event-bus";
import { createHostApplication } from "../application.js";

export interface WorkersRunSummary {
  outboxEventsSent: number;
  inboxEventsProcessed: number;
  backgroundJobWorkerRan: boolean;
  backgroundWorkersRun: number;
}

/**
 * EventBridge-scheduled entry point replacing the .NET background worker timers: one tick of the outbox sender,
 * the inbox processor, the background job worker and every other `runOnce()`-capable worker, inside one DI scope.
 */
export async function runWorkersOnce(): Promise<WorkersRunSummary> {
  const app = await createHostApplication();
  return forkAmbientScope(async () => {
    await using scope = app.serviceProvider.createScope();
    const provider = scope.serviceProvider;
    const outboxEventsSent = await provider.getRequired(OutboxSenderManager).runOnce();
    const inboxEventsProcessed = await provider.getRequired(InboxProcessManager).runOnce();

    const workerManager = provider.getRequired(IBackgroundWorkerManager);
    const jobWorkerManager = provider.getRequired(BackgroundJobWorkerManager);
    const jobWorkerIsManaged = workerManager.workers.includes(jobWorkerManager);
    if (!jobWorkerIsManaged) await jobWorkerManager.runOnce();
    await workerManager.runAllOnce();

    return { outboxEventsSent, inboxEventsProcessed, backgroundJobWorkerRan: true, backgroundWorkersRun: workerManager.workers.length };
  });
}

export const handler = (_event?: unknown): Promise<WorkersRunSummary> => runWorkersOnce();
