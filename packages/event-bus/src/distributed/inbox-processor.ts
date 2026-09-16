import { AbpException, ILoggerFactory, IRootServiceProvider, Singleton, Transient, createToken, optionsToken, throwIfAborted, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { IClock } from "@abp/timing";
import { IUnitOfWorkManager } from "@abp/uow";
import { AbpEventBusBoxesOptions, InboxProcessorFailurePolicy, asSupportsEventBoxes, getEventInboxKey, type IEventInbox, type InboxConfig, type IncomingEventInfo } from "./boxes.js";
import { AbpDistributedEventBusOptions, IDistributedEventBus } from "./distributed-event-bus.js";

/** Port of `IInboxProcessor`; like `IOutboxSender`, the timer loop is replaced by `runOnce()`. */
export interface IInboxProcessor {
  start(inboxConfig: InboxConfig): Promise<void>;
  stop(): Promise<void>;
  /** Processes every waiting inbox event; returns the number of events processed (including discarded ones). */
  runOnce(signal?: AbortSignal): Promise<number>;
}
export const IInboxProcessor = createToken<IInboxProcessor>("IInboxProcessor");

/** Port of `InboxProcessor`. Each event is processed in its own transactional unit of work. */
@Transient(IInboxProcessor)
export class InboxProcessor implements IInboxProcessor {
  static readonly inject = [IRootServiceProvider, IDistributedEventBus, IUnitOfWorkManager, IClock, optionsToken(AbpEventBusBoxesOptions), ILoggerFactory] as const;

  protected readonly eventBusBoxesOptions: AbpEventBusBoxesOptions;
  protected readonly logger: ILogger;
  protected inbox: IEventInbox | undefined;
  protected inboxConfig: InboxConfig | undefined;
  protected lastCleanTime: Date | undefined;
  protected stopped = false;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    protected readonly distributedEventBus: IDistributedEventBus,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    protected readonly clock: IClock,
    eventBusBoxesOptions: IOptions<AbpEventBusBoxesOptions>,
    loggerFactory: ILoggerFactory,
  ) {
    this.eventBusBoxesOptions = eventBusBoxesOptions.value;
    this.logger = loggerFactory.createLogger(InboxProcessor.name);
  }

  async start(inboxConfig: InboxConfig): Promise<void> {
    this.inboxConfig = inboxConfig;
    this.inbox = this.serviceProvider.getRequired(getEventInboxKey(inboxConfig));
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async runOnce(signal?: AbortSignal): Promise<number> {
    if (this.stopped) return 0;
    const { inbox, inboxConfig } = this.requireInbox();
    await this.deleteOldEvents();

    let processed = 0;
    while (true) {
      throwIfAborted(signal);
      const waitingEvents = await this.getWaitingEvents(signal);
      if (waitingEvents.length <= 0) break;

      this.logger.info(`Found ${waitingEvents.length} events in the inbox.`);
      for (const waitingEvent of waitingEvents) {
        this.logger.info(`Start processing the incoming event with id = ${waitingEvent.id}`);
        try {
          await this.runInUnitOfWork(async () => {
            await asSupportsEventBoxes(this.distributedEventBus).processFromInbox(waitingEvent, inboxConfig);
            await inbox.markAsProcessed(waitingEvent.id);
          });
          this.logger.info(`Processed the incoming event with id = ${waitingEvent.id}`);
        } catch (e) {
          this.logger.error(`Event with id = ${waitingEvent.id} processing failed.`, e);
          await this.handleFailure(waitingEvent, e);
        }
        processed++;
      }
    }
    return processed;
  }

  protected async handleFailure(waitingEvent: IncomingEventInfo, error: unknown): Promise<void> {
    const { inbox } = this.requireInbox();
    const policy = this.eventBusBoxesOptions.inboxProcessorFailurePolicy;
    switch (policy) {
      case InboxProcessorFailurePolicy.Retry:
        throw error;
      case InboxProcessorFailurePolicy.RetryLater:
        await this.runInUnitOfWork(async () => {
          if (waitingEvent.nextRetryTime !== undefined) waitingEvent.retryCount++;
          if (waitingEvent.retryCount >= this.eventBusBoxesOptions.inboxProcessorMaxRetryCount) {
            this.logger.warn(`Event with id = ${waitingEvent.id} has exceeded the maximum retry count. Marking it as discarded.`);
            await inbox.retryLater(waitingEvent.id, waitingEvent.retryCount, undefined);
            await inbox.markAsDiscard(waitingEvent.id);
            return;
          }
          waitingEvent.nextRetryTime = this.getNextRetryTime(waitingEvent.retryCount, this.eventBusBoxesOptions.inboxProcessorRetryBackoffFactor);
          this.logger.info(`Event with id = ${waitingEvent.id} will retry later. Current retry count: ${waitingEvent.retryCount}, Next retry time: ${waitingEvent.nextRetryTime.toISOString()}, Max retry count: ${this.eventBusBoxesOptions.inboxProcessorMaxRetryCount}.`);
          await inbox.retryLater(waitingEvent.id, waitingEvent.retryCount, waitingEvent.nextRetryTime);
        });
        return;
      case InboxProcessorFailurePolicy.Discard:
        await this.runInUnitOfWork(async () => {
          this.logger.info(`Event with id = ${waitingEvent.id} will be discarded.`);
          await inbox.markAsDiscard(waitingEvent.id);
        });
        return;
      default: {
        const _exhaustive: never = policy;
        throw new AbpException(`Unknown InboxProcessorFailurePolicy: ${String(_exhaustive)}`);
      }
    }
  }

  protected getNextRetryTime(retryCount: number, factor: number): Date {
    const delaySeconds = factor * Math.pow(2, retryCount);
    return new Date(this.clock.now.getTime() + delaySeconds * 1000);
  }

  protected getWaitingEvents(signal?: AbortSignal): Promise<IncomingEventInfo[]> {
    return this.requireInbox().inbox.getWaitingEvents(this.eventBusBoxesOptions.inboxWaitingEventMaxCount, this.eventBusBoxesOptions.inboxProcessorFilter, signal);
  }

  protected async deleteOldEvents(): Promise<void> {
    const now = this.clock.now;
    if (this.lastCleanTime && this.lastCleanTime.getTime() + this.eventBusBoxesOptions.cleanOldEventTimeIntervalMs > now.getTime()) return;
    await this.requireInbox().inbox.deleteOldEvents();
    this.lastCleanTime = now;
  }

  private async runInUnitOfWork(action: () => Promise<void>): Promise<void> {
    const uow = this.unitOfWorkManager.begin({ isTransactional: true }, true);
    try {
      await action();
      await uow.complete();
    } finally {
      await uow.dispose();
    }
  }

  private requireInbox(): { inbox: IEventInbox; inboxConfig: InboxConfig } {
    if (!this.inbox || !this.inboxConfig) throw new AbpException("InboxProcessor has not been started. Call start(inboxConfig) first.");
    return { inbox: this.inbox, inboxConfig: this.inboxConfig };
  }
}

/** Port of `InboxProcessManager` (the .NET background worker); `runOnce()` is the scheduled entry point. */
@Singleton()
export class InboxProcessManager {
  static readonly inject = [optionsToken(AbpDistributedEventBusOptions), IRootServiceProvider] as const;

  protected readonly options: AbpDistributedEventBusOptions;
  protected readonly processors: IInboxProcessor[] = [];

  constructor(
    options: IOptions<AbpDistributedEventBusOptions>,
    protected readonly serviceProvider: IServiceProvider,
  ) {
    this.options = options.value;
  }

  async start(): Promise<void> {
    if (this.processors.length > 0) return;
    for (const inboxConfig of this.options.inboxes.values()) {
      if (!inboxConfig.isProcessingEnabled) continue;
      const processor = this.serviceProvider.getRequired(IInboxProcessor);
      await processor.start(inboxConfig);
      this.processors.push(processor);
    }
  }

  async stop(): Promise<void> {
    for (const processor of this.processors) await processor.stop();
    this.processors.length = 0;
  }

  /** Runs every started processor once; returns the total number of events processed. */
  async runOnce(signal?: AbortSignal): Promise<number> {
    let processed = 0;
    for (const processor of this.processors) processed += await processor.runOnce(signal);
    return processed;
  }
}
