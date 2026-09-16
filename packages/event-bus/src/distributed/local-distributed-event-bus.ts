import { Dependency, Guid, IRootServiceProvider, Singleton, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { IGuidGenerator } from "@abp/guids";
import { IJsonSerializer } from "@abp/json";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IClock } from "@abp/timing";
import { IUnitOfWorkManager, type IUnitOfWork, type UnitOfWorkEventRecord } from "@abp/uow";
import { ICorrelationIdProvider } from "../correlation-id.js";
import { DistributedEventHandler, IEventHandlerInvoker, type EventHandlerAction, type EventType, type EventTypeWithEventHandlerFactories, type IEventHandler, type IEventHandlerFactory } from "../event-handler.js";
import { ILocalEventBus } from "../local/local-event-bus.js";
import { DistributedEventReceived, DistributedEventSent, DistributedEventSource, type InboxConfig, type IncomingEventInfo, type OutboxConfig, type OutgoingEventInfo } from "./boxes.js";
import { AbpDistributedEventBusOptions, DistributedEventBusBase, IDistributedEventBus } from "./distributed-event-bus.js";

/**
 * Port of `LocalDistributedEventBus`: the in-process `IDistributedEventBus` (default; providers replace it).
 * Delegates subscriptions to `ILocalEventBus` and still honours the outbox/inbox configuration.
 */
@Dependency({ tryRegister: true })
@Singleton(IDistributedEventBus)
export class LocalDistributedEventBus extends DistributedEventBusBase {
  static override readonly inject = [IRootServiceProvider, ICurrentTenant, IUnitOfWorkManager, optionsToken(AbpDistributedEventBusOptions), IGuidGenerator, IClock, IEventHandlerInvoker, ILocalEventBus, ICorrelationIdProvider, IJsonSerializer] as const;

  constructor(
    serviceProvider: IServiceProvider,
    currentTenant: ICurrentTenant,
    unitOfWorkManager: IUnitOfWorkManager,
    abpDistributedEventBusOptions: IOptions<AbpDistributedEventBusOptions>,
    guidGenerator: IGuidGenerator,
    clock: IClock,
    eventHandlerInvoker: IEventHandlerInvoker,
    localEventBus: ILocalEventBus,
    correlationIdProvider: ICorrelationIdProvider,
    protected readonly jsonSerializer: IJsonSerializer,
  ) {
    super(serviceProvider, currentTenant, unitOfWorkManager, abpDistributedEventBusOptions, guidGenerator, clock, eventHandlerInvoker, localEventBus, correlationIdProvider);
    this.subscribeHandlers(this.abpDistributedEventBusOptions.handlers, (handlerType) => DistributedEventHandler.getEventTypes(handlerType));
  }

  protected subscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): Disposable {
    if (typeof eventTypeOrName === "string") {
      this.dynamicEventNames.add(eventTypeOrName);
      return this.localEventBus.subscribe(eventTypeOrName, factory);
    }
    this.eventTypes.add(eventTypeOrName);
    return this.localEventBus.subscribe(eventTypeOrName, factory);
  }

  protected unsubscribeAction(eventTypeOrName: EventType | string, action: EventHandlerAction<unknown>): void {
    this.localEventBus.unsubscribe(eventTypeOrName as EventType, action);
  }

  protected unsubscribeHandler(eventTypeOrName: EventType | string, handler: IEventHandler): void {
    this.localEventBus.unsubscribe(eventTypeOrName as EventType, handler);
  }

  protected unsubscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): void {
    this.localEventBus.unsubscribe(eventTypeOrName, factory);
  }

  unsubscribeAll(eventTypeOrName: EventType | string): void {
    this.localEventBus.unsubscribeAll(eventTypeOrName);
  }

  protected override async publishEvent(eventType: EventType, eventData: object, onUnitOfWorkComplete = true, useOutbox = true): Promise<void> {
    if (onUnitOfWorkComplete && this.unitOfWorkManager.current) {
      await super.publishEvent(eventType, eventData, onUnitOfWorkComplete, useOutbox);
      return;
    }
    if (useOutbox && (await this.addToOutbox(eventType, eventData))) return;

    const eventName = this.getEventName(eventType, eventData);
    await this.triggerDistributedEventSent(new DistributedEventSent(DistributedEventSource.Direct, eventName, this.getEventData(eventData)));
    await this.triggerDistributedEventReceived(new DistributedEventReceived(DistributedEventSource.Direct, eventName, this.getEventData(eventData)));
    await this.publishToEventBus(eventType, eventData);
  }

  protected async publishToEventBus(eventType: EventType, eventData: object): Promise<void> {
    if (await this.addToInbox(Guid.newGuid(), this.getEventName(eventType, eventData), eventType, eventData, undefined, this.getTenantIdToPropagate(eventType, eventData))) return;
    await this.localEventBus.publish(eventType, eventData, false);
  }

  protected addToUnitOfWork(unitOfWork: IUnitOfWork, eventRecord: UnitOfWorkEventRecord): void {
    unitOfWork.addOrReplaceDistributedEvent(eventRecord);
  }

  async publishFromOutbox(outgoingEvent: OutgoingEventInfo, _outboxConfig: OutboxConfig): Promise<void> {
    await this.triggerDistributedEventSent(new DistributedEventSent(DistributedEventSource.Outbox, outgoingEvent.eventName, outgoingEvent.eventData));
    await this.triggerDistributedEventReceived(new DistributedEventReceived(DistributedEventSource.Direct, outgoingEvent.eventName, outgoingEvent.eventData));

    const eventType = this.resolveStoredEventType(outgoingEvent.eventName);
    if (!eventType) return;
    const eventData = this.deserializeEventData(eventType, outgoingEvent.eventName, outgoingEvent.eventData, outgoingEvent.getTenantId());

    if (await this.addToInbox(Guid.newGuid(), outgoingEvent.eventName, eventType, eventData, undefined, outgoingEvent.getTenantId())) return;
    await this.localEventBus.publish(eventType, eventData, false);
  }

  async publishManyFromOutbox(outgoingEvents: readonly OutgoingEventInfo[], outboxConfig: OutboxConfig): Promise<void> {
    for (const outgoingEvent of outgoingEvents) await this.publishFromOutbox(outgoingEvent, outboxConfig);
  }

  async processFromInbox(incomingEvent: IncomingEventInfo, inboxConfig: InboxConfig): Promise<void> {
    const eventType = this.resolveStoredEventType(incomingEvent.eventName);
    if (!eventType) return;
    const eventData = this.deserializeEventData(eventType, incomingEvent.eventName, incomingEvent.eventData, incomingEvent.getTenantId());

    const exceptions: unknown[] = [];
    await this.correlationIdProvider.run(incomingEvent.getCorrelationId(), () => this.triggerHandlersFromInbox(eventType, eventData, exceptions, inboxConfig));
    if (exceptions.length > 0) this.throwOriginalExceptions(eventType, exceptions);
  }

  protected serialize(eventData: object): string {
    return this.jsonSerializer.serialize(eventData);
  }

  protected deserialize(json: string): unknown {
    return this.jsonSerializer.deserialize(json);
  }

  protected getHandlerFactories(eventType: EventType): Iterable<EventTypeWithEventHandlerFactories> {
    return this.localEventBus.getEventHandlerFactories(eventType);
  }

  protected getDynamicHandlerFactories(eventName: string): Iterable<EventTypeWithEventHandlerFactories> {
    return this.localEventBus.getDynamicEventHandlerFactories(eventName);
  }
}
