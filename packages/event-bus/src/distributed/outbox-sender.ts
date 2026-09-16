import { AbpException, ILoggerFactory, IRootServiceProvider, Singleton, Transient, createToken, optionsToken, throwIfAborted, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpEventBusBoxesOptions, asSupportsEventBoxes, getEventOutboxKey, type IEventOutbox, type OutboxConfig, type OutgoingEventInfo } from "./boxes.js";
import { AbpDistributedEventBusOptions, IDistributedEventBus } from "./distributed-event-bus.js";

/**
 * Port of `IOutboxSender`. The .NET timer + distributed lock loop is replaced by `runOnce()`, meant to be invoked
 * by a scheduler (EventBridge → Lambda); `start` only binds the outbox and `stop` disables further runs.
 */
export interface IOutboxSender {
  start(outboxConfig: OutboxConfig): Promise<void>;
  stop(): Promise<void>;
  /** Sends every waiting outbox event; returns the number of events sent. */
  runOnce(signal?: AbortSignal): Promise<number>;
}
export const IOutboxSender = createToken<IOutboxSender>("IOutboxSender");

/** Port of `OutboxSender`. */
@Transient(IOutboxSender)
export class OutboxSender implements IOutboxSender {
  static readonly inject = [IRootServiceProvider, IDistributedEventBus, optionsToken(AbpEventBusBoxesOptions), ILoggerFactory] as const;

  protected readonly eventBusBoxesOptions: AbpEventBusBoxesOptions;
  protected readonly logger: ILogger;
  protected outbox: IEventOutbox | undefined;
  protected outboxConfig: OutboxConfig | undefined;
  protected stopped = false;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    protected readonly distributedEventBus: IDistributedEventBus,
    eventBusBoxesOptions: IOptions<AbpEventBusBoxesOptions>,
    loggerFactory: ILoggerFactory,
  ) {
    this.eventBusBoxesOptions = eventBusBoxesOptions.value;
    this.logger = loggerFactory.createLogger(OutboxSender.name);
  }

  async start(outboxConfig: OutboxConfig): Promise<void> {
    this.outboxConfig = outboxConfig;
    this.outbox = this.serviceProvider.getRequired(getEventOutboxKey(outboxConfig));
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async runOnce(signal?: AbortSignal): Promise<number> {
    if (this.stopped) return 0;
    let sent = 0;
    while (true) {
      throwIfAborted(signal);
      const waitingEvents = await this.getWaitingEvents(signal);
      if (waitingEvents.length <= 0) break;

      this.logger.info(`Found ${waitingEvents.length} events in the outbox.`);
      if (this.eventBusBoxesOptions.batchPublishOutboxEvents) await this.publishOutgoingMessagesInBatch(waitingEvents);
      else await this.publishOutgoingMessages(waitingEvents);
      sent += waitingEvents.length;
    }
    return sent;
  }

  protected getWaitingEvents(signal?: AbortSignal): Promise<OutgoingEventInfo[]> {
    return this.requireOutbox().outbox.getWaitingEvents(this.eventBusBoxesOptions.outboxWaitingEventMaxCount, this.eventBusBoxesOptions.outboxProcessorFilter, signal);
  }

  protected async publishOutgoingMessages(waitingEvents: readonly OutgoingEventInfo[]): Promise<void> {
    const { outbox, outboxConfig } = this.requireOutbox();
    for (const waitingEvent of waitingEvents) {
      await asSupportsEventBoxes(this.distributedEventBus).publishFromOutbox(waitingEvent, outboxConfig);
      await outbox.delete(waitingEvent.id);
      this.logger.info(`Sent the event to the message broker with id = ${waitingEvent.id}`);
    }
  }

  protected async publishOutgoingMessagesInBatch(waitingEvents: readonly OutgoingEventInfo[]): Promise<void> {
    const { outbox, outboxConfig } = this.requireOutbox();
    await asSupportsEventBoxes(this.distributedEventBus).publishManyFromOutbox(waitingEvents, outboxConfig);
    await outbox.deleteMany(waitingEvents.map((x) => x.id));
    this.logger.info(`Sent ${waitingEvents.length} events to message broker`);
  }

  private requireOutbox(): { outbox: IEventOutbox; outboxConfig: OutboxConfig } {
    if (!this.outbox || !this.outboxConfig) throw new AbpException("OutboxSender has not been started. Call start(outboxConfig) first.");
    return { outbox: this.outbox, outboxConfig: this.outboxConfig };
  }
}

/** Port of `OutboxSenderManager` (the .NET background worker); `runOnce()` is the scheduled entry point. */
@Singleton()
export class OutboxSenderManager {
  static readonly inject = [optionsToken(AbpDistributedEventBusOptions), IRootServiceProvider] as const;

  protected readonly options: AbpDistributedEventBusOptions;
  protected readonly senders: IOutboxSender[] = [];

  constructor(
    options: IOptions<AbpDistributedEventBusOptions>,
    protected readonly serviceProvider: IServiceProvider,
  ) {
    this.options = options.value;
  }

  async start(): Promise<void> {
    if (this.senders.length > 0) return;
    for (const outboxConfig of this.options.outboxes.values()) {
      if (!outboxConfig.isSendingEnabled) continue;
      const sender = this.serviceProvider.getRequired(IOutboxSender);
      await sender.start(outboxConfig);
      this.senders.push(sender);
    }
  }

  async stop(): Promise<void> {
    for (const sender of this.senders) await sender.stop();
    this.senders.length = 0;
  }

  /** Runs every started sender once; returns the total number of events sent. */
  async runOnce(signal?: AbortSignal): Promise<number> {
    let sent = 0;
    for (const sender of this.senders) sent += await sender.runOnce(signal);
    return sent;
  }
}
