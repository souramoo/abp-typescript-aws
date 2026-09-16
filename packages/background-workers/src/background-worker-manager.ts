import { Singleton, createToken } from "@abp/core";
import type { IBackgroundWorker } from "./background-worker.js";

/** A worker that can execute a single tick on demand (serverless hosting). */
export interface IRunOnceBackgroundWorker extends IBackgroundWorker {
  runOnce(): Promise<void>;
}

export function supportsRunOnce(worker: IBackgroundWorker): worker is IRunOnceBackgroundWorker {
  return typeof (worker as IRunOnceBackgroundWorker).runOnce === "function";
}

/** Port of `IBackgroundWorkerManager` (+ `runAllOnce()` for scheduled Lambda invocations). */
export interface IBackgroundWorkerManager {
  /** Adds a worker (resolved from DI). Starts it immediately if the manager has started. */
  add(worker: IBackgroundWorker, signal?: AbortSignal): Promise<void>;
  start(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  /** Runs one tick of every worker that supports `runOnce()`, sequentially, without starting timers. */
  runAllOnce(): Promise<void>;
  readonly workers: readonly IBackgroundWorker[];
}
export const IBackgroundWorkerManager = createToken<IBackgroundWorkerManager>("IBackgroundWorkerManager");

/** Port of `BackgroundWorkerManager`. */
@Singleton(IBackgroundWorkerManager)
export class BackgroundWorkerManager implements IBackgroundWorkerManager {
  protected isRunning = false;
  private readonly backgroundWorkers: IBackgroundWorker[] = [];

  get workers(): readonly IBackgroundWorker[] {
    return this.backgroundWorkers;
  }

  async add(worker: IBackgroundWorker, signal?: AbortSignal): Promise<void> {
    this.backgroundWorkers.push(worker);
    if (this.isRunning) await worker.start(signal);
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.isRunning = true;
    for (const worker of this.backgroundWorkers) await worker.start(signal);
  }

  async stop(signal?: AbortSignal): Promise<void> {
    this.isRunning = false;
    for (const worker of this.backgroundWorkers) await worker.stop(signal);
  }

  async runAllOnce(): Promise<void> {
    for (const worker of this.backgroundWorkers) {
      if (supportsRunOnce(worker)) await worker.runOnce();
    }
  }
}
