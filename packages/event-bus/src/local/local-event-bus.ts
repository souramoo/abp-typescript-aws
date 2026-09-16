import { Check, Guid, ILoggerFactory, IRootServiceProvider, Singleton, TypeList, createToken, optionsToken, removeAll, type Class, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager, type IUnitOfWork, type UnitOfWorkEventRecord } from "@abp/uow";
import { EventBusBase, type IEventBus } from "../event-bus.js";
import { DynamicEventData } from "../event-data.js";
import { EventTypeWithEventHandlerFactories, IEventHandlerInvoker, LocalEventHandler, getLocalEventHandlerOrder, type EventHandlerAction, type EventType, type IEventHandler, type IEventHandlerFactory } from "../event-handler.js";
import { EventTypeRegistry } from "../event-name.js";
import { ActionEventHandler, EventHandlerFactoryUnregistrar, SingleInstanceHandlerFactory, getHandlerTypeOfFactory } from "../handler-factories.js";

/** Port of `AbpLocalEventBusOptions`. */
export class AbpLocalEventBusOptions {
  readonly handlers = new TypeList<IEventHandler>();
}

/** Port of `ILocalEventBus`. */
export interface ILocalEventBus extends IEventBus {
  getEventHandlerFactories(eventType: EventType): EventTypeWithEventHandlerFactories[];
  getDynamicEventHandlerFactories(eventName: string): EventTypeWithEventHandlerFactories[];
}
export const ILocalEventBus = createToken<ILocalEventBus>("ILocalEventBus");

/** Port of `LocalEventMessage`. */
export class LocalEventMessage {
  constructor(
    readonly messageId: Guid,
    readonly eventData: object,
    readonly eventType: EventType,
  ) {}
}

interface OrderedFactory {
  readonly factory: IEventHandlerFactory;
  readonly eventType: EventType;
  readonly order: number;
}

function shouldTriggerEventForHandler(targetEventType: EventType, handlerEventType: EventType): boolean {
  return handlerEventType === targetEventType || targetEventType.prototype instanceof handlerEventType;
}

/** Port of `LocalEventBus` (singleton). Handlers for a base event class also receive its subclasses. */
@Singleton(ILocalEventBus)
export class LocalEventBus extends EventBusBase implements ILocalEventBus {
  static override readonly inject = [optionsToken(AbpLocalEventBusOptions), IRootServiceProvider, ICurrentTenant, IUnitOfWorkManager, IEventHandlerInvoker, ILoggerFactory] as const;

  protected readonly options: AbpLocalEventBusOptions;
  protected readonly logger: ILogger;
  protected readonly handlerFactories = new Map<EventType, IEventHandlerFactory[]>();
  protected readonly eventTypes = new EventTypeRegistry();
  protected readonly dynamicEventHandlerFactories = new Map<string, IEventHandlerFactory[]>();

  constructor(options: IOptions<AbpLocalEventBusOptions>, serviceProvider: IServiceProvider, currentTenant: ICurrentTenant, unitOfWorkManager: IUnitOfWorkManager, eventHandlerInvoker: IEventHandlerInvoker, loggerFactory: ILoggerFactory) {
    super(serviceProvider, currentTenant, unitOfWorkManager, eventHandlerInvoker);
    this.options = options.value;
    this.logger = loggerFactory.createLogger(LocalEventBus.name);
    this.subscribeHandlers(this.options.handlers, (handlerType) => LocalEventHandler.getEventTypes(handlerType));
  }

  protected subscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): Disposable {
    if (typeof eventTypeOrName !== "string") this.eventTypes.add(eventTypeOrName);
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

  protected publishByName(eventName: string, eventData: object, onUnitOfWorkComplete: boolean): Promise<void> {
    const eventType = this.eventTypes.getOrDefault(eventName);
    const dynamicEventData = eventData instanceof DynamicEventData ? eventData : new DynamicEventData(eventName, eventData);
    if (eventType) return this.publishEvent(eventType, this.convertDynamicEventData(dynamicEventData.data, eventType), onUnitOfWorkComplete);
    return this.publishEvent(DynamicEventData, dynamicEventData, onUnitOfWorkComplete);
  }

  protected async publishToEventBus(eventType: EventType, eventData: object): Promise<void> {
    await this.publishMessage(new LocalEventMessage(Guid.newGuid(), eventData, eventType));
  }

  protected addToUnitOfWork(unitOfWork: IUnitOfWork, eventRecord: UnitOfWorkEventRecord): void {
    unitOfWork.addOrReplaceLocalEvent(eventRecord);
  }

  /** Port of `PublishAsync(LocalEventMessage)`. */
  async publishMessage(localEventMessage: LocalEventMessage): Promise<void> {
    await this.triggerHandlers(localEventMessage.eventType, localEventMessage.eventData);
  }

  getEventHandlerFactories(eventType: EventType): EventTypeWithEventHandlerFactories[] {
    return [...this.getHandlerFactories(eventType)];
  }

  getDynamicEventHandlerFactories(eventName: string): EventTypeWithEventHandlerFactories[] {
    return [...this.getDynamicHandlerFactories(eventName)];
  }

  protected getHandlerFactories(eventType: EventType): EventTypeWithEventHandlerFactories[] {
    const list: OrderedFactory[] = [];
    const eventNames = [...this.eventTypes].filter(([, type]) => shouldTriggerEventForHandler(eventType, type)).map(([name]) => name);

    for (const [handlerEventType, factories] of this.handlerFactories) {
      if (!shouldTriggerEventForHandler(eventType, handlerEventType)) continue;
      for (const factory of factories) list.push({ factory, eventType: handlerEventType, order: orderOf(factory) });
    }
    for (const [eventName, factories] of this.dynamicEventHandlerFactories) {
      if (!eventNames.includes(eventName)) continue;
      for (const factory of factories) list.push({ factory, eventType: DynamicEventData, order: orderOf(factory) });
    }
    return toOrderedResult(list);
  }

  protected getDynamicHandlerFactories(eventName: string): EventTypeWithEventHandlerFactories[] {
    const eventType = this.eventTypes.getOrDefault(eventName);
    if (eventType) return this.getHandlerFactories(eventType);
    const factories = this.dynamicEventHandlerFactories.get(eventName) ?? [];
    return toOrderedResult(factories.map((factory) => ({ factory, eventType: DynamicEventData, order: orderOf(factory) })));
  }

  protected getEventTypeByEventName(eventName: string): EventType | undefined {
    return this.eventTypes.getOrDefault(eventName);
  }

  private getOrCreateFactories(eventTypeOrName: EventType | string): IEventHandlerFactory[] {
    if (typeof eventTypeOrName === "string") return getOrAddList(this.dynamicEventHandlerFactories, eventTypeOrName);
    return getOrAddList(this.handlerFactories, eventTypeOrName);
  }
}

function getOrAddList<K>(map: Map<K, IEventHandlerFactory[]>, key: K): IEventHandlerFactory[] {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  return list;
}

function orderOf(factory: IEventHandlerFactory): number {
  return getLocalEventHandlerOrder(getHandlerTypeOfFactory(factory) as Class | undefined);
}

function toOrderedResult(list: OrderedFactory[]): EventTypeWithEventHandlerFactories[] {
  return list.sort((a, b) => a.order - b.order).map((x) => new EventTypeWithEventHandlerFactories(x.eventType, [x.factory]));
}

/** Port of `NullLocalEventBus`. */
export class NullLocalEventBus implements ILocalEventBus {
  static readonly instance = new NullLocalEventBus();

  async publish(): Promise<void> {}
  subscribe(): Disposable {
    return { [Symbol.dispose]: () => {} };
  }
  unsubscribe(): void {}
  unsubscribeAll(): void {}
  getEventHandlerFactories(): EventTypeWithEventHandlerFactories[] {
    return [];
  }
  getDynamicEventHandlerFactories(): EventTypeWithEventHandlerFactories[] {
    return [];
  }
}
