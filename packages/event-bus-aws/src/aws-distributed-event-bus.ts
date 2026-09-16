import { PublishBatchCommand, PublishCommand, type MessageAttributeValue, type PublishBatchRequestEntry, type SNSClient } from "@aws-sdk/client-sns";
import { AbpException, Check, Dependency, IRootServiceProvider, Singleton, isNullOrWhiteSpace, optionsToken, removeAll, type Guid, type IOptions, type IServiceProvider } from "@abp/core";
import {
  AbpDistributedEventBusOptions,
  ActionEventHandler,
  DistributedEventBusBase,
  DistributedEventHandler,
  DistributedEventSent,
  DistributedEventSource,
  DynamicEventData,
  EventBusTenantIdHelper,
  EventHandlerFactoryUnregistrar,
  EventTypeWithEventHandlerFactories,
  ICorrelationIdProvider,
  IDistributedEventBus,
  IEventHandlerInvoker,
  ILocalEventBus,
  SingleInstanceHandlerFactory,
  type EventHandlerAction,
  type EventType,
  type IEventHandler,
  type IEventHandlerFactory,
  type InboxConfig,
  type IncomingEventInfo,
  type OutboxConfig,
  type OutgoingEventInfo,
} from "@abp/event-bus";
import { IGuidGenerator } from "@abp/guids";
import { IJsonSerializer } from "@abp/json";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IClock } from "@abp/timing";
import { IUnitOfWorkManager, type IUnitOfWork, type UnitOfWorkEventRecord } from "@abp/uow";
import { AbpAwsEventBusOptions } from "./abp-aws-event-bus-options.js";
import { AwsEventMessageAttributes, type AwsIncomingEventMessage } from "./aws-event-message.js";
import { ISnsClientFactory } from "./sns-client-factory.js";

const PublishBatchLimit = 10;

function shouldTriggerEventForHandler(targetEventType: EventType, handlerEventType: EventType): boolean {
  return handlerEventType === targetEventType || targetEventType.prototype instanceof handlerEventType;
}

/**
 * Port of the RabbitMQ/Azure distributed event buses on SNS (publish) + SQS (consume through
 * `createSqsEventsHandler`). Messages carry the event name, correlation id and tenant id as SNS message attributes.
 */
@Dependency({ replaceServices: true })
@Singleton(IDistributedEventBus)
export class AwsDistributedEventBus extends DistributedEventBusBase {
  static override readonly inject = [IRootServiceProvider, ICurrentTenant, IUnitOfWorkManager, optionsToken(AbpDistributedEventBusOptions), IGuidGenerator, IClock, IEventHandlerInvoker, ILocalEventBus, ICorrelationIdProvider, IJsonSerializer, optionsToken(AbpAwsEventBusOptions), ISnsClientFactory] as const;

  protected readonly options: AbpAwsEventBusOptions;
  protected readonly handlerFactories = new Map<EventType, IEventHandlerFactory[]>();
  protected readonly dynamicHandlerFactories = new Map<string, IEventHandlerFactory[]>();
  private client: SNSClient | undefined;

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
    options: IOptions<AbpAwsEventBusOptions>,
    protected readonly snsClientFactory: ISnsClientFactory,
  ) {
    super(serviceProvider, currentTenant, unitOfWorkManager, abpDistributedEventBusOptions, guidGenerator, clock, eventHandlerInvoker, localEventBus, correlationIdProvider);
    this.options = options.value;
    this.subscribeHandlers(this.abpDistributedEventBusOptions.handlers, (handlerType) => DistributedEventHandler.getEventTypes(handlerType));
  }

  /** Port of `ProcessEventAsync`: routes one received message to the inbox (when configured) or to the handlers. */
  async processIncoming(message: AwsIncomingEventMessage): Promise<void> {
    const eventType = this.resolveStoredEventType(message.eventName);
    if (!eventType) return;
    const tenantId = EventBusTenantIdHelper.parse(message.tenantId);
    const eventData = this.deserializeEventData(eventType, message.eventName, message.eventData, tenantId);

    if (await this.addToInbox(message.messageId, message.eventName, eventType, eventData, message.correlationId, tenantId)) return;
    await this.correlationIdProvider.run(message.correlationId, () => this.triggerHandlersDirect(eventType, eventData));
  }

  protected subscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): Disposable {
    if (typeof eventTypeOrName === "string") this.dynamicEventNames.add(eventTypeOrName);
    else this.eventTypes.add(eventTypeOrName);
    const factories = this.getOrCreateFactories(eventTypeOrName);
    if (!factory.isInFactories(factories)) factories.push(factory);
    return new EventHandlerFactoryUnregistrar(this, eventTypeOrName, factory);
  }

  protected unsubscribeAction(eventTypeOrName: EventType | string, action: EventHandlerAction<unknown>): void {
    Check.notNull(action, "action");
    removeAll(this.getOrCreateFactories(eventTypeOrName), (factory) => factory instanceof SingleInstanceHandlerFactory && factory.handlerInstance instanceof ActionEventHandler && factory.handlerInstance.action === action);
  }

  protected unsubscribeHandler(eventTypeOrName: EventType | string, handler: IEventHandler): void {
    removeAll(this.getOrCreateFactories(eventTypeOrName), (factory) => factory instanceof SingleInstanceHandlerFactory && factory.handlerInstance === handler);
  }

  protected unsubscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): void {
    removeAll(this.getOrCreateFactories(eventTypeOrName), (existing) => existing === factory || factory.isInFactories([existing]));
  }

  unsubscribeAll(eventTypeOrName: EventType | string): void {
    this.getOrCreateFactories(eventTypeOrName).length = 0;
  }

  protected async publishToEventBus(eventType: EventType, eventData: object): Promise<void> {
    const { eventName, eventData: resolvedData } = this.resolveEventForPublishing(eventType, eventData);
    await this.publishMessage(eventName, this.serialize(resolvedData), this.correlationIdProvider.get(), undefined, this.getTenantIdToPropagate(eventType, eventData));
  }

  protected addToUnitOfWork(unitOfWork: IUnitOfWork, eventRecord: UnitOfWorkEventRecord): void {
    unitOfWork.addOrReplaceDistributedEvent(eventRecord);
  }

  async publishFromOutbox(outgoingEvent: OutgoingEventInfo, _outboxConfig: OutboxConfig): Promise<void> {
    await this.publishMessage(outgoingEvent.eventName, outgoingEvent.eventData, outgoingEvent.getCorrelationId(), outgoingEvent.id, outgoingEvent.getTenantId());
    await this.correlationIdProvider.run(outgoingEvent.getCorrelationId(), () => this.triggerDistributedEventSent(new DistributedEventSent(DistributedEventSource.Outbox, outgoingEvent.eventName, outgoingEvent.eventData)));
  }

  /** Sends the outbox events in `PublishBatch` calls of at most 10 messages (the SNS limit). */
  async publishManyFromOutbox(outgoingEvents: readonly OutgoingEventInfo[], _outboxConfig: OutboxConfig): Promise<void> {
    for (let i = 0; i < outgoingEvents.length; i += PublishBatchLimit) {
      const batch = outgoingEvents.slice(i, i + PublishBatchLimit);
      const entries: PublishBatchRequestEntry[] = batch.map((e) => ({ Id: e.id, Message: e.eventData, MessageAttributes: this.buildAttributes(e.eventName, e.getCorrelationId(), e.id, e.getTenantId()) }));
      const response = await this.snsClient.send(new PublishBatchCommand({ TopicArn: this.topicArn, PublishBatchRequestEntries: entries }));
      if (response.Failed && response.Failed.length > 0) {
        throw new AbpException(`Publishing ${response.Failed.length} of ${batch.length} outbox events to SNS failed: ${response.Failed.map((f) => `${f.Id}: ${f.Code} ${f.Message ?? ""}`).join("; ")}`);
      }
    }
    for (const outgoingEvent of outgoingEvents) {
      await this.correlationIdProvider.run(outgoingEvent.getCorrelationId(), () => this.triggerDistributedEventSent(new DistributedEventSent(DistributedEventSource.Outbox, outgoingEvent.eventName, outgoingEvent.eventData)));
    }
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

  protected async publishMessage(eventName: string, body: string, correlationId: string | undefined, eventId: Guid | undefined, tenantId: Guid | undefined): Promise<void> {
    await this.snsClient.send(new PublishCommand({ TopicArn: this.topicArn, Message: body, MessageAttributes: this.buildAttributes(eventName, correlationId, eventId ?? this.guidGenerator.create(), tenantId) }));
  }

  protected buildAttributes(eventName: string, correlationId: string | undefined, messageId: Guid, tenantId: Guid | undefined): Record<string, MessageAttributeValue> {
    const attributes: Record<string, MessageAttributeValue> = {
      [AwsEventMessageAttributes.EventName]: { DataType: "String", StringValue: eventName },
      [AwsEventMessageAttributes.MessageId]: { DataType: "String", StringValue: messageId },
    };
    if (!isNullOrWhiteSpace(correlationId)) attributes[AwsEventMessageAttributes.CorrelationId] = { DataType: "String", StringValue: correlationId };
    if (tenantId !== undefined) attributes[AwsEventMessageAttributes.TenantId] = { DataType: "String", StringValue: tenantId };
    return attributes;
  }

  protected getHandlerFactories(eventType: EventType): EventTypeWithEventHandlerFactories[] {
    const result: EventTypeWithEventHandlerFactories[] = [];
    const eventNames = [...this.eventTypes].filter(([, type]) => shouldTriggerEventForHandler(eventType, type)).map(([name]) => name);
    for (const [handlerEventType, factories] of this.handlerFactories) {
      if (shouldTriggerEventForHandler(eventType, handlerEventType)) result.push(new EventTypeWithEventHandlerFactories(handlerEventType, factories));
    }
    for (const [eventName, factories] of this.dynamicHandlerFactories) {
      if (eventNames.includes(eventName)) result.push(new EventTypeWithEventHandlerFactories(DynamicEventData, factories));
    }
    return result;
  }

  protected getDynamicHandlerFactories(eventName: string): EventTypeWithEventHandlerFactories[] {
    const eventType = this.getEventTypeByEventName(eventName);
    if (eventType) return this.getHandlerFactories(eventType);
    const factories = this.dynamicHandlerFactories.get(eventName);
    return factories ? [new EventTypeWithEventHandlerFactories(DynamicEventData, factories)] : [];
  }

  private getOrCreateFactories(eventTypeOrName: EventType | string): IEventHandlerFactory[] {
    if (typeof eventTypeOrName === "string") {
      let list = this.dynamicHandlerFactories.get(eventTypeOrName);
      if (!list) {
        list = [];
        this.dynamicHandlerFactories.set(eventTypeOrName, list);
      }
      return list;
    }
    let list = this.handlerFactories.get(eventTypeOrName);
    if (!list) {
      list = [];
      this.handlerFactories.set(eventTypeOrName, list);
    }
    return list;
  }

  protected get topicArn(): string {
    const arn = this.options.topicArn;
    if (!arn) throw new AbpException("AbpAwsEventBusOptions.topicArn is not configured (set EventBus:Aws:TopicArn).");
    return arn;
  }

  protected get snsClient(): SNSClient {
    this.client ??= this.options.createSnsClient?.() ?? this.snsClientFactory.getClient();
    return this.client;
  }
}
