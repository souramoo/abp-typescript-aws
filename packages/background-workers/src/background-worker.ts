import { ILogger, ILoggerFactory, NullLogger, createToken, type IAbpLazyServiceProvider, type IServiceProvider } from "@abp/core";

/** Port of `IBackgroundWorker` (`IRunnable`). Workers are singletons (`@Singleton()`), resolved from DI. */
export interface IBackgroundWorker {
  start(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
}
export const IBackgroundWorker = createToken<IBackgroundWorker>("IBackgroundWorker");

export function isBackgroundWorker(value: unknown): value is IBackgroundWorker {
  return typeof value === "object" && value !== null && typeof (value as IBackgroundWorker).start === "function" && typeof (value as IBackgroundWorker).stop === "function";
}

/** Port of `BackgroundWorkerBase`. `lazyServiceProvider` is property-injected by the container. */
export abstract class BackgroundWorkerBase implements IBackgroundWorker {
  lazyServiceProvider!: IAbpLazyServiceProvider;
  protected stoppingController = new AbortController();

  get serviceProvider(): IServiceProvider {
    return this.lazyServiceProvider.serviceProvider;
  }

  protected get loggerFactory(): ILoggerFactory {
    return this.lazyServiceProvider.lazyGetRequiredService(ILoggerFactory);
  }

  protected get logger(): ILogger {
    if (!this.lazyServiceProvider) return NullLogger.instance;
    return this.lazyServiceProvider.lazyGetServiceFrom(ILogger, (p) => p.get(ILoggerFactory)?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }

  /** Port of `StoppingToken`: aborted by `stop()`. */
  protected get stoppingSignal(): AbortSignal {
    return this.stoppingController.signal;
  }

  async start(_signal?: AbortSignal): Promise<void> {
    if (this.stoppingController.signal.aborted) this.stoppingController = new AbortController();
    this.logger.debug(`Started background worker: ${this.toString()}`);
  }

  async stop(_signal?: AbortSignal): Promise<void> {
    this.logger.debug(`Stopped background worker: ${this.toString()}`);
    this.stoppingController.abort();
  }

  toString(): string {
    return this.constructor.name;
  }
}
