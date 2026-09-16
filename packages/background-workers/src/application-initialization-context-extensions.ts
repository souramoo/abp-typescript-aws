import { AbpException, Check, type ApplicationInitializationContext, type Class } from "@abp/core";
import { isBackgroundWorker, type IBackgroundWorker } from "./background-worker.js";
import { IBackgroundWorkerManager } from "./background-worker-manager.js";

/** Port of `context.AddBackgroundWorkerAsync<TWorker>()`: resolves the worker from DI and adds it to the manager. */
export async function addBackgroundWorker(context: ApplicationInitializationContext, workerType: Class<IBackgroundWorker>, signal?: AbortSignal): Promise<ApplicationInitializationContext> {
  Check.notNull(context, "context");
  Check.notNull(workerType, "workerType");
  const worker = context.serviceProvider.getRequired(workerType);
  if (!isBackgroundWorker(worker)) {
    throw new AbpException(`Given type (${workerType.name}) must implement the IBackgroundWorker interface (start/stop), but it doesn't!`);
  }
  await context.serviceProvider.getRequired(IBackgroundWorkerManager).add(worker, signal);
  return context;
}
