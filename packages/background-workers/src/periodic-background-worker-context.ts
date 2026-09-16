import type { IServiceProvider } from "@abp/core";

/** Port of `PeriodicBackgroundWorkerContext`: a scoped provider per tick plus the worker's cancellation signal. */
export class PeriodicBackgroundWorkerContext {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly signal: AbortSignal,
  ) {}
}
