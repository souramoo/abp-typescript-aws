import { createToken } from "../dependency-injection/service-token.js";
import { LogLevel, ILoggerFactory, type ILogger } from "../logging/logger.js";
import { IServiceProviderToken, type IServiceProvider } from "../dependency-injection/service-provider.js";
import { Transient } from "../dependency-injection/injectable.js";
import { TypeList } from "../collections/type-list.js";
import type { Class } from "../dependency-injection/service-token.js";

/** Port of `ExceptionNotificationContext`. */
export class ExceptionNotificationContext {
  constructor(
    readonly exception: unknown,
    readonly logLevel: LogLevel = LogLevel.Error,
    readonly handled = true,
  ) {}
}

/** Port of `IExceptionSubscriber`: implement and add to `AbpExceptionHandlingOptions.subscribers`. */
export interface IExceptionSubscriber {
  handle(context: ExceptionNotificationContext): Promise<void>;
}
export abstract class ExceptionSubscriber implements IExceptionSubscriber {
  abstract handle(context: ExceptionNotificationContext): Promise<void>;
}

export class AbpExceptionHandlingOptions {
  readonly subscribers = new TypeList<IExceptionSubscriber>();
}

export interface IExceptionNotifier {
  notify(context: ExceptionNotificationContext): Promise<void>;
}
export const IExceptionNotifier = createToken<IExceptionNotifier>("IExceptionNotifier");

@Transient(IExceptionNotifier)
export class ExceptionNotifier implements IExceptionNotifier {
  static readonly inject = [IServiceProviderToken, ILoggerFactory] as const;
  private readonly logger: ILogger;
  constructor(
    private readonly serviceProvider: IServiceProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(ExceptionNotifier.name);
  }

  async notify(context: ExceptionNotificationContext): Promise<void> {
    const options = this.serviceProvider.getOptions(AbpExceptionHandlingOptions);
    for (const type of options.subscribers as Iterable<Class<IExceptionSubscriber>>) {
      const subscriber = this.serviceProvider.getRequired(type);
      try {
        await subscriber.handle(context);
      } catch (e) {
        this.logger.warn(`Exception subscriber of type ${type.name} has thrown an exception!`, undefined, e);
      }
    }
  }
}

export class NullExceptionNotifier implements IExceptionNotifier {
  static readonly instance = new NullExceptionNotifier();
  async notify(): Promise<void> {}
}

export async function notifyException(notifier: IExceptionNotifier, exception: unknown, logLevel?: LogLevel, handled = true): Promise<void> {
  await notifier.notify(new ExceptionNotificationContext(exception, logLevel, handled));
}
