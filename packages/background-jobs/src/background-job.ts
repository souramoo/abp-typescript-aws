import { AbpException, ILogger, ILoggerFactory, NullLogger, type AbstractClass, type Class, type IAbpLazyServiceProvider } from "@abp/core";

/**
 * Port of `IBackgroundJob<TArgs>` / `IAsyncBackgroundJob<TArgs>` (merged: every job is asynchronous here).
 * `TArgs` is erased at runtime, so a job class declares its args class with `@BackgroundJob(ArgsClass)` (or
 * `static readonly argsType = ArgsClass`); the args class identifies the job when enqueuing.
 */
export interface IBackgroundJob<TArgs> {
  execute(args: TArgs): Promise<void>;
}

const argsTypes = new WeakMap<AbstractClass, Class>();

function decorator(argsType: Class) {
  return (target: AbstractClass): void => {
    argsTypes.set(target, argsType);
  };
}

/**
 * Marks a job class and records its args type (replaces the `IBackgroundJob<TArgs>` generic interface).
 * `@Transient()` job classes decorated with it are added to `AbpBackgroundJobOptions` automatically.
 */
export const BackgroundJob = Object.assign(decorator, {
  getArgsTypeOrNull(jobType: AbstractClass | undefined): Class | undefined {
    let current: unknown = jobType;
    while (typeof current === "function" && current !== Function.prototype) {
      const fromDecorator = argsTypes.get(current as AbstractClass);
      if (fromDecorator) return fromDecorator;
      if (Object.prototype.hasOwnProperty.call(current, "argsType")) {
        const fromStatic = (current as { argsType?: unknown }).argsType;
        if (typeof fromStatic === "function") return fromStatic as Class;
      }
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  },
  has(jobType: AbstractClass | undefined): boolean {
    return BackgroundJob.getArgsTypeOrNull(jobType) !== undefined;
  },
});

/** Port of `BackgroundJobArgsHelper`. */
export const BackgroundJobArgsHelper = {
  getJobArgsType(jobType: AbstractClass): Class {
    const argsType = BackgroundJob.getArgsTypeOrNull(jobType);
    if (!argsType) {
      throw new AbpException(`Could not find type of the job args. Ensure that given type is decorated with @BackgroundJob(ArgsClass) or declares 'static argsType'. Given job type: ${jobType.name}`);
    }
    return argsType;
  },
  tryGetJobArgsType(jobType: AbstractClass): Class | undefined {
    return BackgroundJob.getArgsTypeOrNull(jobType);
  },
};

/** Port of `AsyncBackgroundJob<TArgs>` (and `BackgroundJob<TArgs>`). `lazyServiceProvider` is property-injected. */
export abstract class AsyncBackgroundJob<TArgs> implements IBackgroundJob<TArgs> {
  lazyServiceProvider!: IAbpLazyServiceProvider;

  protected get logger(): ILogger {
    if (!this.lazyServiceProvider) return NullLogger.instance;
    return this.lazyServiceProvider.lazyGetServiceFrom(ILogger, (p) => p.get(ILoggerFactory)?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }

  abstract execute(args: TArgs): Promise<void>;
}
