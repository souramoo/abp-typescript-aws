import { IRootServiceProvider, TypeList, createToken, optionsToken, type Guid, type IOptions, type IServiceProvider, type ServiceKey } from "@abp/core";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IClock } from "@abp/timing";
import { EventOrderGenerator, IUnitOfWorkManager, UnitOfWorkEventRecord } from "@abp/uow";
import { ICorrelationIdProvider } from "../correlation-id.js";
import { EventBusBase, parsePublishArguments, type IEventBus } from "../event-bus.js";
import { DynamicEventData } from "../event-data.js";
import { IEventHandlerInvoker, type EventType, type IEventHandler } from "../event-handler.js";
import { EventNameAttribute, EventTypeRegistry } from "../event-name.js";
import { ILocalEventBus } from "../local/local-event-bus.js";
import { DistributedEventReceived, DistributedEventSent, DistributedEventSource, InboxConfigDictionary, IncomingEventInfo, OutboxConfigDictionary, OutgoingEventInfo, getEventInboxKey, getEventOutboxKey, type ISupportsEventBoxes, type InboxConfig, type OutboxConfig } from "./boxes.js";

/** Port of `AbpDistributedEventBusOptions`. */
export class AbpDistributedEventBusOptions {
  readonly handlers = new TypeList<IEventHandler>();
  readonly outboxes = new OutboxConfigDictionary();
  readonly inboxes = new InboxConfigDictionary();
}

/** Port of `IDistributedEventBus` (`useOutbox` is the extra trailing flag of `publish`). */
export interface IDistributedEventBus extends IEventBus {
  publish<TEvent extends object>(eventTypeOrName: EventType<TEvent> | string, eventData: TEvent, onUnitOfWorkComplete?: boolean, useOutbox?: boolean): Promise<void>;
  publish(eventData: object, onUnitOfWorkComplete?: boolean, useOutbox?: boolean): Promise<void>;
}
export const IDistributedEventBus = createToken<IDistributedEventBus>("IDistributedEventBus");

/**
 * Port of `DistributedEventBusBase`. The event-name → class registry (`EventTypes`) lives here instead of in every
 * provider so any transport can rebuild event instances from outbox/inbox/broker messages.
 */
export abstract class DistributedEventBusBase extends EventBusBase implements IDistributedEventBus, ISupportsEventBoxes {
  static override readonly inject: readonly ServiceKey[] = [IRootServiceProvider, ICurrentTenant, IUnitOfWorkManager, optionsToken(AbpDistributedEventBusOptions), IGuidGenerator, IClock, IEventHandlerInvoker, ILocalEventBus, ICorrelationIdProvider];

  protected readonly abpDistributedEventBusOptions: AbpDistributedEventBusOptions;
  protected readonly eventTypes = new EventTypeRegistry();
  protected readonly dynamicEventNames = new Set<string>();

  constructor(
    serviceProvider: IServiceProvider,
    currentTenant: ICurrentTenant,
    unitOfWorkManager: IUnitOfWorkManager,
    abpDistributedEventBusOptions: IOptions<AbpDistributedEventBusOptions>,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly clock: IClock,
    eventHandlerInvoker: IEventHandlerInvoker,
    protected readonly localEventBus: ILocalEventBus,
    protected readonly correlationIdProvider: ICorrelationIdProvider,
  ) {
    super(serviceProvider, currentTenant, unitOfWorkManager, eventHandlerInvoker);
    this.abpDistributedEventBusOptions = abpDistributedEventBusOptions.value;
  }

  override publish<TEvent extends object>(eventTypeOrName: EventType<TEvent> | string, eventData: TEvent, onUnitOfWorkComplete?: boolean, useOutbox?: boolean): Promise<void>;
  override publish(eventData: object, onUnitOfWorkComplete?: boolean, useOutbox?: boolean): Promise<void>;
  override publish(first: unknown, ...rest: unknown[]): Promise<void> {
    const request = parsePublishArguments(first, rest);
    const onUnitOfWorkComplete = request.flags[0] ?? true;
    const useOutbox = request.flags[1] ?? true;
    if (typeof request.eventTypeOrName === "string") return this.publishByName(request.eventTypeOrName, request.eventData, onUnitOfWorkComplete, useOutbox);
    return this.publishEvent(request.eventTypeOrName, request.eventData, onUnitOfWorkComplete, useOutbox);
  }

  /** Makes event classes known by name before any subscription (needed to deserialize messages of unhandled events). */
  registerEventTypes(...eventTypes: EventType[]): void {
    for (const eventType of eventTypes) this.eventTypes.add(eventType);
  }

  protected override async publishEvent(eventType: EventType, eventData: object, onUnitOfWorkComplete = true, useOutbox = true): Promise<void> {
    const currentUow = this.unitOfWorkManager.current;
    if (onUnitOfWorkComplete && currentUow) {
      this.addToUnitOfWork(currentUow, new UnitOfWorkEventRecord(eventType, eventData, EventOrderGenerator.getNext(), useOutbox));
      return;
    }

    if (useOutbox && (await this.addToOutbox(eventType, eventData))) return;

    await this.publishToEventBus(eventType, eventData);
    await this.triggerDistributedEventSent(new DistributedEventSent(DistributedEventSource.Direct, this.getEventName(eventType, eventData), this.getEventData(eventData)));
  }

  protected publishByName(eventName: string, eventData: object, onUnitOfWorkComplete: boolean, useOutbox = true): Promise<void> {
    const eventType = this.getEventTypeByEventName(eventName);
    const dynamicEventData = this.createDynamicEventDataForPublishing(eventName, eventData);
    if (eventType) return this.publishEvent(eventType, this.convertDynamicEventData(dynamicEventData.data, eventType), onUnitOfWorkComplete, useOutbox);
    return this.publishEvent(DynamicEventData, dynamicEventData, onUnitOfWorkComplete, useOutbox);
  }

  abstract publishFromOutbox(outgoingEvent: OutgoingEventInfo, outboxConfig: OutboxConfig): Promise<void>;
  abstract publishManyFromOutbox(outgoingEvents: readonly OutgoingEventInfo[], outboxConfig: OutboxConfig): Promise<void>;
  abstract processFromInbox(incomingEvent: IncomingEventInfo, inboxConfig: InboxConfig): Promise<void>;

  protected async addToOutbox(eventType: EventType, eventData: object): Promise<boolean> {
    const unitOfWork = this.unitOfWorkManager.current;
    if (!unitOfWork) return false;

    let addedToOutbox = false;
    const tenantId = this.getTenantIdToPropagate(eventType, eventData);
    for (const outboxConfig of sortedBySelector([...this.abpDistributedEventBusOptions.outboxes.values()], (c) => c.selector)) {
      if (outboxConfig.selector && !outboxConfig.selector(eventType)) continue;

      const eventOutbox = unitOfWork.serviceProvider.getRequired(getEventOutboxKey(outboxConfig));
      const { eventName, eventData: resolvedEventData } = this.resolveEventForPublishing(eventType, eventData);
      await this.onAddToOutbox(eventName, eventType, resolvedEventData);

      const outgoingEventInfo = new OutgoingEventInfo(this.guidGenerator.create(), eventName, this.serialize(resolvedEventData), this.clock.now);
      const correlationId = this.correlationIdProvider.get();
      if (correlationId !== undefined) outgoingEventInfo.setCorrelationId(correlationId);
      outgoingEventInfo.setTenantId(tenantId);

      await eventOutbox.enqueue(outgoingEventInfo);
      addedToOutbox = true;
    }
    return addedToOutbox;
  }

  protected async onAddToOutbox(_eventName: string, eventType: EventType, _eventData: object): Promise<void> {
    if (eventType !== DynamicEventData) this.eventTypes.add(eventType);
  }

  protected async addToInbox(messageId: string | undefined, eventName: string, eventType: EventType, eventData: object, correlationId: string | undefined, tenantId: Guid | undefined = undefined): Promise<boolean> {
    if (this.abpDistributedEventBusOptions.inboxes.size <= 0) return false;

    let addedToInbox = false;
    const scope = this.serviceProvider.createScope();
    try {
      for (const inboxConfig of sortedBySelector([...this.abpDistributedEventBusOptions.inboxes.values()], (c) => c.eventSelector)) {
        if (inboxConfig.eventSelector && !inboxConfig.eventSelector(eventType)) continue;

        const eventInbox = scope.serviceProvider.getRequired(getEventInboxKey(inboxConfig));
        if (messageId && (await eventInbox.existsByMessageId(messageId))) {
          addedToInbox = true;
          continue;
        }

        const incomingEventInfo = new IncomingEventInfo(this.guidGenerator.create(), messageId ?? "", eventName, this.serialize(this.getEventData(eventData)), this.clock.now);
        incomingEventInfo.setCorrelationId(correlationId);
        incomingEventInfo.setTenantId(tenantId);
        await eventInbox.enqueue(incomingEventInfo);
        addedToInbox = true;
      }
    } finally {
      await scope.dispose();
    }
    return addedToInbox;
  }

  /** Serializes event data to the JSON text stored in boxes / sent to the broker (`byte[]` in .NET). */
  protected abstract serialize(eventData: object): string;

  /** Parses JSON text produced by {@link serialize} into plain data. */
  protected abstract deserialize(json: string): unknown;

  /** Resolves the event class for a stored event name: a registered class, `DynamicEventData` for dynamic names, else undefined. */
  protected resolveStoredEventType(eventName: string): EventType | undefined {
    const eventType = this.eventTypes.getOrDefault(eventName);
    if (eventType) return eventType;
    return this.dynamicEventNames.has(eventName) ? DynamicEventData : undefined;
  }

  /** Rebuilds the event object of a stored event (typed events become class instances, dynamic ones `DynamicEventData`). */
  protected deserializeEventData(eventType: EventType, eventName: string, json: string, tenantId: Guid | undefined): object {
    const data = this.deserialize(json);
    const plain = typeof data === "object" && data !== null ? data : { value: data };
    if (eventType === DynamicEventData) return this.createDynamicEventData(eventName, plain, tenantId);
    return this.convertDynamicEventData(plain, eventType);
  }

  protected async triggerHandlersDirect(eventType: EventType, eventData: object): Promise<void> {
    await this.triggerDistributedEventReceived(new DistributedEventReceived(DistributedEventSource.Direct, this.getEventName(eventType, eventData), this.getEventData(eventData)));
    await this.triggerHandlers(eventType, eventData);
  }

  protected async triggerHandlersFromInbox(eventType: EventType, eventData: object, exceptions: unknown[], inboxConfig?: InboxConfig): Promise<void> {
    await this.triggerDistributedEventReceived(new DistributedEventReceived(DistributedEventSource.Inbox, this.getEventName(eventType, eventData), this.getEventData(eventData)));
    await this.triggerHandlersCore(eventType, eventData, exceptions, inboxConfig);
  }

  async triggerDistributedEventSent(distributedEvent: DistributedEventSent): Promise<void> {
    try {
      await this.localEventBus.publish(distributedEvent, false);
    } catch {
      // ignored, as in .NET
    }
  }

  async triggerDistributedEventReceived(distributedEvent: DistributedEventReceived): Promise<void> {
    try {
      await this.localEventBus.publish(distributedEvent, false);
    } catch {
      // ignored, as in .NET
    }
  }

  protected getEventName(eventType: EventType, eventData: object): string {
    if (eventData instanceof DynamicEventData) return eventData.eventName;
    return EventNameAttribute.getNameOrDefault(eventType);
  }

  protected createDynamicEventDataForPublishing(eventName: string, eventData: object): DynamicEventData {
    const dynamicEventData = eventData instanceof DynamicEventData ? eventData : new DynamicEventData(eventName, eventData);
    return dynamicEventData.setTenantId(this.currentTenant.id);
  }

  protected getTenantIdToPropagate(eventType: EventType, eventData: object): Guid | undefined {
    if (eventType !== DynamicEventData) return undefined;
    if (eventData instanceof DynamicEventData) {
      const info = eventData.isMultiTenant();
      if (info.isMultiTenant) return info.tenantId;
    }
    return this.currentTenant.id;
  }

  protected createDynamicEventData(eventName: string, data: object, tenantId: Guid | undefined): DynamicEventData {
    const dynamicEventData = new DynamicEventData(eventName, data);
    return tenantId === undefined ? dynamicEventData : dynamicEventData.setTenantId(tenantId);
  }

  protected getEventData(eventData: object): object {
    return eventData instanceof DynamicEventData ? eventData.data : eventData;
  }

  protected resolveEventForPublishing(eventType: EventType, eventData: object): { eventName: string; eventData: object } {
    return { eventName: this.getEventName(eventType, eventData), eventData: this.getEventData(eventData) };
  }

  protected getEventTypeByEventName(eventName: string): EventType | undefined {
    return this.eventTypes.getOrDefault(eventName);
  }
}

/** `OrderBy(x => x.Selector is null)`: configs with a selector first. */
function sortedBySelector<T>(configs: T[], selectorOf: (config: T) => unknown): T[] {
  return configs.sort((a, b) => Number(selectorOf(a) === undefined) - Number(selectorOf(b) === undefined));
}

/** Port of `NullDistributedEventBus`. */
export class NullDistributedEventBus implements IDistributedEventBus {
  static readonly instance = new NullDistributedEventBus();

  async publish(): Promise<void> {}
  subscribe(): Disposable {
    return { [Symbol.dispose]: () => {} };
  }
  unsubscribe(): void {}
  unsubscribeAll(): void {}
}

