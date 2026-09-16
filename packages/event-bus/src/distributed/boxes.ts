import { AbpException, Check, createToken, keyedToken, type Class, type Guid, type ServiceKey, type ServiceToken } from "@abp/core";
import { EventBusConsts, EventBusTenantIdHelper } from "../event-data.js";
import type { EventType } from "../event-handler.js";

/** Port of `DistributedEventSource`. */
export enum DistributedEventSource {
  Direct = "Direct",
  Inbox = "Inbox",
  Outbox = "Outbox",
}

/** Port of `DistributedEventSent` (published on the local event bus after a distributed event is sent). */
export class DistributedEventSent {
  constructor(
    public source: DistributedEventSource,
    public eventName: string,
    public eventData: unknown,
  ) {}
}

/** Port of `DistributedEventReceived`. */
export class DistributedEventReceived {
  constructor(
    public source: DistributedEventSource,
    public eventName: string,
    public eventData: unknown,
  ) {}
}

/** Port of `IOutgoingEventInfo`. `eventData` is the serialized JSON text (`byte[]` in .NET). */
export interface IOutgoingEventInfo {
  readonly id: Guid;
  readonly eventName: string;
  readonly eventData: string;
  readonly creationTime: Date;
  readonly extraProperties: Map<string, unknown>;
}

/** Port of `OutgoingEventInfo`. */
export class OutgoingEventInfo implements IOutgoingEventInfo {
  static maxEventNameLength = 256;

  readonly extraProperties = new Map<string, unknown>();
  readonly eventName: string;

  constructor(
    readonly id: Guid,
    eventName: string,
    readonly eventData: string,
    readonly creationTime: Date,
  ) {
    this.eventName = Check.notNullOrWhiteSpace(eventName, "eventName", OutgoingEventInfo.maxEventNameLength);
  }

  setCorrelationId(correlationId: string): void {
    this.extraProperties.set(EventBusConsts.CorrelationIdHeaderName, correlationId);
  }

  getCorrelationId(): string | undefined {
    return correlationIdOf(this.extraProperties);
  }

  setTenantId(tenantId: Guid | undefined): void {
    setTenantIdProperty(this.extraProperties, tenantId);
  }

  getTenantId(): Guid | undefined {
    return tenantIdOf(this.extraProperties);
  }
}

/** Port of `IncomingEventStatus`. */
export enum IncomingEventStatus {
  Pending = 0,
  Discarded = 1,
  Processed = 2,
}

/** Port of `IIncomingEventInfo`. */
export interface IIncomingEventInfo {
  readonly id: Guid;
  readonly messageId: string;
  readonly eventName: string;
  readonly eventData: string;
  readonly creationTime: Date;
  readonly extraProperties: Map<string, unknown>;
}

/** Port of `IncomingEventInfo`. */
export class IncomingEventInfo implements IIncomingEventInfo {
  static maxEventNameLength = 256;

  readonly extraProperties = new Map<string, unknown>();
  readonly eventName: string;

  constructor(
    readonly id: Guid,
    readonly messageId: string,
    eventName: string,
    readonly eventData: string,
    readonly creationTime: Date,
    public status: IncomingEventStatus = IncomingEventStatus.Pending,
    public handledTime: Date | undefined = undefined,
    public retryCount = 0,
    public nextRetryTime: Date | undefined = undefined,
  ) {
    this.eventName = Check.notNullOrWhiteSpace(eventName, "eventName", IncomingEventInfo.maxEventNameLength);
  }

  setCorrelationId(correlationId: string | undefined): void {
    if (correlationId === undefined) this.extraProperties.delete(EventBusConsts.CorrelationIdHeaderName);
    else this.extraProperties.set(EventBusConsts.CorrelationIdHeaderName, correlationId);
  }

  getCorrelationId(): string | undefined {
    return correlationIdOf(this.extraProperties);
  }

  setTenantId(tenantId: Guid | undefined): void {
    setTenantIdProperty(this.extraProperties, tenantId);
  }

  getTenantId(): Guid | undefined {
    return tenantIdOf(this.extraProperties);
  }
}

function correlationIdOf(extraProperties: Map<string, unknown>): string | undefined {
  const value = extraProperties.get(EventBusConsts.CorrelationIdHeaderName);
  return value === undefined || value === null ? undefined : String(value);
}

function setTenantIdProperty(extraProperties: Map<string, unknown>, tenantId: Guid | undefined): void {
  if (tenantId === undefined) extraProperties.delete(EventBusConsts.TenantIdHeaderName);
  else extraProperties.set(EventBusConsts.TenantIdHeaderName, tenantId);
}

function tenantIdOf(extraProperties: Map<string, unknown>): Guid | undefined {
  const value = extraProperties.get(EventBusConsts.TenantIdHeaderName);
  return EventBusTenantIdHelper.parse(value === undefined || value === null ? undefined : String(value));
}

/** Port of `IEventOutbox`. The `Expression` filter is a plain predicate here. */
export interface IEventOutbox {
  enqueue(outgoingEvent: OutgoingEventInfo): Promise<void>;
  getWaitingEvents(maxCount: number, filter?: (event: IOutgoingEventInfo) => boolean, signal?: AbortSignal): Promise<OutgoingEventInfo[]>;
  delete(id: Guid): Promise<void>;
  deleteMany(ids: readonly Guid[]): Promise<void>;
}
export const IEventOutbox = createToken<IEventOutbox>("IEventOutbox");

/** Port of `IEventInbox`. */
export interface IEventInbox {
  enqueue(incomingEvent: IncomingEventInfo): Promise<void>;
  getWaitingEvents(maxCount: number, filter?: (event: IIncomingEventInfo) => boolean, signal?: AbortSignal): Promise<IncomingEventInfo[]>;
  markAsProcessed(id: Guid): Promise<void>;
  retryLater(id: Guid, retryCount: number, nextRetryTime: Date | undefined): Promise<void>;
  markAsDiscard(id: Guid): Promise<void>;
  existsByMessageId(messageId: string): Promise<boolean>;
  deleteOldEvents(): Promise<void>;
}
export const IEventInbox = createToken<IEventInbox>("IEventInbox");

/** `IEventOutbox` keyed by database (db-context) name, the port of registering the outbox per `DbContext`. */
export function eventOutboxToken(databaseName: string): ServiceToken<IEventOutbox> {
  return keyedToken<IEventOutbox>(IEventOutbox, databaseName);
}

/** `IEventInbox` keyed by database (db-context) name. */
export function eventInboxToken(databaseName: string): ServiceToken<IEventInbox> {
  return keyedToken<IEventInbox>(IEventInbox, databaseName);
}

/** Port of `OutboxConfig`. `implementationType` defaults to `eventOutboxToken(databaseName)`. */
export class OutboxConfig {
  readonly name: string;
  #databaseName = "";
  implementationType: ServiceKey<IEventOutbox> | undefined;
  selector: ((eventType: EventType) => boolean) | undefined;
  /** Used to enable/disable sending events from outbox to the message broker. Default: true. */
  isSendingEnabled = true;

  constructor(name: string) {
    this.name = Check.notNullOrWhiteSpace(name, "name");
  }

  get databaseName(): string {
    return this.#databaseName;
  }

  set databaseName(value: string) {
    this.#databaseName = Check.notNullOrWhiteSpace(value, "databaseName");
  }
}

/** Port of `InboxConfig`. `implementationType` defaults to `eventInboxToken(databaseName)`. */
export class InboxConfig {
  readonly name: string;
  #databaseName = "";
  implementationType: ServiceKey<IEventInbox> | undefined;
  eventSelector: ((eventType: EventType) => boolean) | undefined;
  handlerSelector: ((handlerType: Class) => boolean) | undefined;
  /** Used to enable/disable processing incoming events. Default: true. */
  isProcessingEnabled = true;

  constructor(name: string) {
    this.name = Check.notNullOrWhiteSpace(name, "name");
  }

  get databaseName(): string {
    return this.#databaseName;
  }

  set databaseName(value: string) {
    this.#databaseName = Check.notNullOrWhiteSpace(value, "databaseName");
  }
}

export function getEventOutboxKey(config: OutboxConfig): ServiceKey<IEventOutbox> {
  if (config.implementationType) return config.implementationType;
  if (!config.databaseName) throw new AbpException(`Outbox '${config.name}' has neither an implementationType nor a databaseName.`);
  return eventOutboxToken(config.databaseName);
}

export function getEventInboxKey(config: InboxConfig): ServiceKey<IEventInbox> {
  if (config.implementationType) return config.implementationType;
  if (!config.databaseName) throw new AbpException(`Inbox '${config.name}' has neither an implementationType nor a databaseName.`);
  return eventInboxToken(config.databaseName);
}

/** Port of `OutboxConfigDictionary`. */
export class OutboxConfigDictionary extends Map<string, OutboxConfig> {
  configure(configAction: (config: OutboxConfig) => void): void;
  configure(outboxName: string, configAction: (config: OutboxConfig) => void): void;
  configure(nameOrAction: string | ((config: OutboxConfig) => void), configAction?: (config: OutboxConfig) => void): void {
    const name = typeof nameOrAction === "string" ? nameOrAction : "Default";
    const action = typeof nameOrAction === "string" ? configAction! : nameOrAction;
    let config = this.get(name);
    if (!config) {
      config = new OutboxConfig(name);
      this.set(name, config);
    }
    action(config);
  }
}

/** Port of `InboxConfigDictionary`. */
export class InboxConfigDictionary extends Map<string, InboxConfig> {
  configure(configAction: (config: InboxConfig) => void): void;
  configure(inboxName: string, configAction: (config: InboxConfig) => void): void;
  configure(nameOrAction: string | ((config: InboxConfig) => void), configAction?: (config: InboxConfig) => void): void {
    const name = typeof nameOrAction === "string" ? nameOrAction : "Default";
    const action = typeof nameOrAction === "string" ? configAction! : nameOrAction;
    let config = this.get(name);
    if (!config) {
      config = new InboxConfig(name);
      this.set(name, config);
    }
    action(config);
  }
}

/** Port of `InboxProcessorFailurePolicy`. */
export enum InboxProcessorFailurePolicy {
  /** Default behavior: the failed event is retried on the next run. */
  Retry = "Retry",
  /** Skip the failed event and retry it after an exponentially growing delay; discard after the max retry count. */
  RetryLater = "RetryLater",
  /** Skip the event and do not retry it. */
  Discard = "Discard",
}

/** Port of `AbpEventBusBoxesOptions` (durations in milliseconds). */
export class AbpEventBusBoxesOptions {
  /** Default: 6 hours. */
  cleanOldEventTimeIntervalMs = 6 * 60 * 60 * 1000;
  /** Default: 1000. */
  inboxWaitingEventMaxCount = 1000;
  /** Default: undefined, means all events. */
  inboxProcessorFilter: ((event: IIncomingEventInfo) => boolean) | undefined = undefined;
  /** Default: 1000. */
  outboxWaitingEventMaxCount = 1000;
  /** Default: undefined, means all events. */
  outboxProcessorFilter: ((event: IOutgoingEventInfo) => boolean) | undefined = undefined;
  /** Period of `InboxProcessor` and `OutboxSender` when run by a scheduler. Default: 2 seconds. */
  periodTimeMs = 2000;
  /** Default: `InboxProcessorFailurePolicy.Retry`. */
  inboxProcessorFailurePolicy: InboxProcessorFailurePolicy = InboxProcessorFailurePolicy.Retry;
  /** Default: 10. */
  inboxProcessorMaxRetryCount = 10;
  /** Retry delay (seconds) = `inboxProcessorRetryBackoffFactor * 2^retryCount` under `RetryLater`. Default: 10. */
  inboxProcessorRetryBackoffFactor = 10;
  /** Default: 15 seconds. */
  distributedLockWaitDurationMs = 15 * 1000;
  /** Default: 2 hours. */
  waitTimeToDeleteProcessedInboxEventsMs = 2 * 60 * 60 * 1000;
  /** Default: true. */
  batchPublishOutboxEvents = true;
}

/** Port of `ISupportsEventBoxes`. */
export interface ISupportsEventBoxes {
  publishFromOutbox(outgoingEvent: OutgoingEventInfo, outboxConfig: OutboxConfig): Promise<void>;
  publishManyFromOutbox(outgoingEvents: readonly OutgoingEventInfo[], outboxConfig: OutboxConfig): Promise<void>;
  processFromInbox(incomingEvent: IncomingEventInfo, inboxConfig: InboxConfig): Promise<void>;
}

export function supportsEventBoxes(value: unknown): value is ISupportsEventBoxes {
  const bus = value as ISupportsEventBoxes;
  return typeof value === "object" && value !== null && typeof bus.publishFromOutbox === "function" && typeof bus.publishManyFromOutbox === "function" && typeof bus.processFromInbox === "function";
}

/** Port of `AbpDistributedEventBusExtensions.AsSupportsEventBoxes`. */
export function asSupportsEventBoxes(eventBus: object): ISupportsEventBoxes {
  if (!supportsEventBoxes(eventBus)) throw new AbpException(`Given type (${eventBus.constructor.name}) should implement ISupportsEventBoxes!`);
  return eventBus;
}
