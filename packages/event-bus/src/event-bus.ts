import { AbpException, Check, IRootServiceProvider, isClass, type Class, type Guid, type IServiceProvider, type ServiceKey } from "@abp/core";
import { ICurrentTenant, isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { EventOrderGenerator, IUnitOfWorkManager, UnitOfWorkEventRecord, type IUnitOfWork } from "@abp/uow";
import { AggregateException, DynamicEventData, isEventDataMayHaveTenantId } from "./event-data.js";
import { IEventHandlerInvoker, isEventHandlerFactory, type EventHandlerAction, type EventType, type EventTypeWithEventHandlerFactories, type IEventHandler, type IEventHandlerFactory } from "./event-handler.js";
import { EventNameAttribute } from "./event-name.js";
import { ActionEventHandler, IocEventHandlerFactory, SingleInstanceHandlerFactory, TransientEventHandlerFactory } from "./handler-factories.js";
import type { InboxConfig } from "./distributed/boxes.js";

/** Anything `subscribe` accepts: a handler instance, a function, a handler class (`new()` per event) or a factory. */
export type EventSubscriber<TEvent extends object> = IEventHandler<TEvent> | EventHandlerAction<TEvent> | Class<IEventHandler<TEvent>> | IEventHandlerFactory;

/**
 * Port of `IEventBus`. The generic/`Type`/`string` overloads collapse to: `publish(EventClass | "name", data)` or
 * `publish(data)` (the event type is the runtime class of `data`); `subscribe(EventClass | "name", subscriber)`.
 */
export interface IEventBus {
  publish<TEvent extends object>(eventTypeOrName: EventType<TEvent> | string, eventData: TEvent, onUnitOfWorkComplete?: boolean): Promise<void>;
  publish(eventData: object, onUnitOfWorkComplete?: boolean): Promise<void>;
  subscribe<TEvent extends object>(eventType: EventType<TEvent>, subscriber: EventSubscriber<TEvent>): Disposable;
  subscribe(eventName: string, subscriber: EventSubscriber<DynamicEventData>): Disposable;
  subscribe(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): Disposable;
  unsubscribe<TEvent extends object>(eventType: EventType<TEvent>, subscriber: EventSubscriber<TEvent>): void;
  unsubscribe(eventName: string, subscriber: EventSubscriber<DynamicEventData>): void;
  unsubscribe(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): void;
  unsubscribeAll(eventTypeOrName: EventType | string): void;
}

export interface PublishRequest {
  readonly eventTypeOrName: EventType | string;
  readonly eventData: object;
  /** Trailing boolean flags (`onUnitOfWorkComplete`, `useOutbox`). */
  readonly flags: readonly (boolean | undefined)[];
}

/** Splits the `publish(...)` overload arguments (shared by local and distributed buses). */
export function parsePublishArguments(first: unknown, rest: readonly unknown[]): PublishRequest {
  if (typeof first === "function" || typeof first === "string") {
    const [eventData, ...flags] = rest;
    if (typeof eventData !== "object" || eventData === null) throw new AbpException("publish(eventType, eventData) requires an event data object.");
    return { eventTypeOrName: first as EventType | string, eventData, flags: flags as (boolean | undefined)[] };
  }
  if (typeof first !== "object" || first === null) throw new AbpException("publish() requires an event data object, an event class or an event name.");
  return { eventTypeOrName: first.constructor as EventType, eventData: first, flags: rest as (boolean | undefined)[] };
}

export function toEventHandlerFactory(subscriber: EventSubscriber<never>): IEventHandlerFactory {
  if (isEventHandlerFactory(subscriber)) return subscriber;
  if (isClass(subscriber)) return new TransientEventHandlerFactory(subscriber as Class<IEventHandler>);
  if (typeof subscriber === "function") return new SingleInstanceHandlerFactory(new ActionEventHandler(subscriber as EventHandlerAction<unknown>));
  return new SingleInstanceHandlerFactory(subscriber as IEventHandler);
}

/** Port of `EventBusBase`. */
export abstract class EventBusBase implements IEventBus {
  static readonly inject: readonly ServiceKey[] = [IRootServiceProvider, ICurrentTenant, IUnitOfWorkManager, IEventHandlerInvoker];

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    protected readonly eventHandlerInvoker: IEventHandlerInvoker,
  ) {}

  subscribe<TEvent extends object>(eventType: EventType<TEvent>, subscriber: EventSubscriber<TEvent>): Disposable;
  subscribe(eventName: string, subscriber: EventSubscriber<DynamicEventData>): Disposable;
  subscribe(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): Disposable;
  subscribe(eventTypeOrName: EventType | string, subscriber: EventSubscriber<never>): Disposable {
    Check.notNull(subscriber, "subscriber");
    return this.subscribeFactory(eventTypeOrName, toEventHandlerFactory(subscriber));
  }

  unsubscribe<TEvent extends object>(eventType: EventType<TEvent>, subscriber: EventSubscriber<TEvent>): void;
  unsubscribe(eventName: string, subscriber: EventSubscriber<DynamicEventData>): void;
  unsubscribe(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): void;
  unsubscribe(eventTypeOrName: EventType | string, subscriber: EventSubscriber<never>): void {
    Check.notNull(subscriber, "subscriber");
    if (isEventHandlerFactory(subscriber) || isClass(subscriber)) {
      this.unsubscribeFactory(eventTypeOrName, toEventHandlerFactory(subscriber));
    } else if (typeof subscriber === "function") {
      this.unsubscribeAction(eventTypeOrName, subscriber as EventHandlerAction<unknown>);
    } else {
      this.unsubscribeHandler(eventTypeOrName, subscriber as IEventHandler);
    }
  }

  abstract unsubscribeAll(eventTypeOrName: EventType | string): void;

  publish<TEvent extends object>(eventTypeOrName: EventType<TEvent> | string, eventData: TEvent, onUnitOfWorkComplete?: boolean): Promise<void>;
  publish(eventData: object, onUnitOfWorkComplete?: boolean): Promise<void>;
  publish(first: unknown, ...rest: unknown[]): Promise<void> {
    const request = parsePublishArguments(first, rest);
    const onUnitOfWorkComplete = request.flags[0] ?? true;
    if (typeof request.eventTypeOrName === "string") return this.publishByName(request.eventTypeOrName, request.eventData, onUnitOfWorkComplete);
    return this.publishEvent(request.eventTypeOrName, request.eventData, onUnitOfWorkComplete);
  }

  /** Port of `PublishAsync(Type eventType, object eventData, bool onUnitOfWorkComplete)`. */
  protected async publishEvent(eventType: EventType, eventData: object, onUnitOfWorkComplete = true): Promise<void> {
    const currentUow = this.unitOfWorkManager.current;
    if (onUnitOfWorkComplete && currentUow) {
      this.addToUnitOfWork(currentUow, new UnitOfWorkEventRecord(eventType, eventData, EventOrderGenerator.getNext()));
      return;
    }
    await this.publishToEventBus(eventType, eventData);
  }

  /** Port of `PublishAsync(string eventName, object eventData, bool onUnitOfWorkComplete)`. */
  protected abstract publishByName(eventName: string, eventData: object, onUnitOfWorkComplete: boolean): Promise<void>;

  protected abstract subscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): Disposable;
  protected abstract unsubscribeFactory(eventTypeOrName: EventType | string, factory: IEventHandlerFactory): void;
  protected abstract unsubscribeHandler(eventTypeOrName: EventType | string, handler: IEventHandler): void;
  protected abstract unsubscribeAction(eventTypeOrName: EventType | string, action: EventHandlerAction<unknown>): void;
  protected abstract publishToEventBus(eventType: EventType, eventData: object): Promise<void>;
  protected abstract addToUnitOfWork(unitOfWork: IUnitOfWork, eventRecord: UnitOfWorkEventRecord): void;
  protected abstract getHandlerFactories(eventType: EventType): Iterable<EventTypeWithEventHandlerFactories>;
  protected abstract getDynamicHandlerFactories(eventName: string): Iterable<EventTypeWithEventHandlerFactories>;
  protected abstract getEventTypeByEventName(eventName: string): EventType | undefined;

  async triggerHandlers(eventType: EventType, eventData: object): Promise<void> {
    const exceptions: unknown[] = [];
    await this.triggerHandlersCore(eventType, eventData, exceptions);
    if (exceptions.length > 0) this.throwOriginalExceptions(eventType, exceptions);
  }

  /**
   * Port of `TriggerHandlersAsync(eventType, eventData, exceptions, inboxConfig)`. The
   * `IEventDataWithInheritableGenericArgument` re-publishing is not ported: there are no generic event types.
   */
  protected async triggerHandlersCore(eventType: EventType, eventData: object, exceptions: unknown[], inboxConfig?: InboxConfig): Promise<void> {
    for (const handlerFactories of this.resolveHandlerFactories(eventType, eventData)) {
      for (const handlerFactory of [...handlerFactories.eventHandlerFactories]) {
        const resolvedEventData = this.resolveEventDataForHandler(eventData, eventType, handlerFactories.eventType);
        await this.triggerHandler(handlerFactory, handlerFactories.eventType, resolvedEventData, exceptions, inboxConfig);
      }
    }
  }

  protected resolveHandlerFactories(eventType: EventType, eventData: object): EventTypeWithEventHandlerFactories[] {
    if (eventData instanceof DynamicEventData) return [...this.getDynamicHandlerFactories(eventData.eventName)];
    return [...this.getHandlerFactories(eventType)];
  }

  protected resolveEventDataForHandler(eventData: object, sourceEventType: EventType, handlerEventType: EventType): object {
    if (eventData instanceof DynamicEventData && handlerEventType !== DynamicEventData) return this.convertDynamicEventData(eventData.data, handlerEventType);
    if (handlerEventType === DynamicEventData && !(eventData instanceof DynamicEventData)) return new DynamicEventData(EventNameAttribute.getNameOrDefault(sourceEventType), eventData);
    return eventData;
  }

  /**
   * Port of `ConvertDynamicEventData` (.NET: serialize + deserialize to the target type). Without runtime types the
   * data is parsed by the class's static `schema` when it has one, otherwise re-attached to the class prototype.
   */
  protected convertDynamicEventData(data: object, targetType: EventType): object {
    if (data instanceof targetType) return data;
    const schema = (targetType as { schema?: { parse?: (input: unknown) => unknown } }).schema;
    if (schema && typeof schema.parse === "function") return schema.parse(data) as object;
    return Object.assign(Object.create(targetType.prototype as object) as object, data);
  }

  protected throwOriginalExceptions(eventType: EventType, exceptions: readonly unknown[]): never {
    if (exceptions.length === 1) throw exceptions[0];
    throw new AggregateException(`More than one error has occurred while triggering the event: ${eventType.name}`, exceptions);
  }

  /** Port of `SubscribeHandlers(ITypeList<IEventHandler>)`; `eventTypesOf` reads the handler's declared event classes. */
  protected subscribeHandlers(handlers: Iterable<Class>, eventTypesOf: (handlerType: Class) => readonly EventType[]): void {
    for (const handlerType of handlers) {
      for (const eventType of eventTypesOf(handlerType)) {
        this.subscribeFactory(eventType, new IocEventHandlerFactory(this.serviceProvider, handlerType as Class<IEventHandler>));
      }
    }
  }

  protected async triggerHandler(handlerFactory: IEventHandlerFactory, eventType: EventType, eventData: object, exceptions: unknown[], inboxConfig?: InboxConfig): Promise<void> {
    const wrapper = handlerFactory.getHandler();
    try {
      const handlerType = wrapper.eventHandler.constructor as Class;
      if (inboxConfig?.handlerSelector && !inboxConfig.handlerSelector(handlerType)) return;
      await this.currentTenant.run(this.getEventDataTenantId(eventData), undefined, () => this.invokeEventHandler(wrapper.eventHandler, eventData, eventType));
    } catch (e) {
      exceptions.push(e);
    } finally {
      await wrapper.dispose();
    }
  }

  protected invokeEventHandler(eventHandler: IEventHandler, eventData: object, eventType: EventType): Promise<void> {
    return this.eventHandlerInvoker.invoke(eventHandler, eventData, eventType);
  }

  protected getEventDataTenantId(eventData: object): Guid | undefined {
    if (isMultiTenant(eventData)) return eventData.tenantId ?? undefined;
    if (isEventDataMayHaveTenantId(eventData)) {
      const info = eventData.isMultiTenant();
      if (info.isMultiTenant) return info.tenantId;
    }
    return this.currentTenant.id;
  }
}
