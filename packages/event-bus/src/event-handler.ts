import { AbpException, Singleton, createToken, type AbstractClass, type Class } from "@abp/core";

/** An event is identified by its class (port of `Type eventType`). */
export type EventType<TEvent extends object = object> = Class<TEvent>;

/**
 * Port of `IEventHandler` + `ILocalEventHandler<TEvent>`/`IDistributedEventHandler<TEvent>`. All three share the
 * single `handleEvent` method here because TypeScript cannot implement one generic interface several times.
 */
export interface IEventHandler<TEvent = unknown> {
  handleEvent(eventData: TEvent): Promise<void>;
}
export type ILocalEventHandler<TEvent> = IEventHandler<TEvent>;
export type IDistributedEventHandler<TEvent> = IEventHandler<TEvent>;

export function isEventHandler(value: unknown): value is IEventHandler {
  return typeof value === "object" && value !== null && typeof (value as IEventHandler).handleEvent === "function";
}

export type EventHandlerAction<TEvent> = (eventData: TEvent) => Promise<void> | void;

/** Port of `IEventHandlerDisposeWrapper` (dispose may be async because service scopes dispose asynchronously). */
export interface IEventHandlerDisposeWrapper {
  readonly eventHandler: IEventHandler;
  dispose(): void | Promise<void>;
}

export class EventHandlerDisposeWrapper implements IEventHandlerDisposeWrapper {
  constructor(
    readonly eventHandler: IEventHandler,
    private readonly disposeAction?: () => void | Promise<void>,
  ) {}

  dispose(): void | Promise<void> {
    return this.disposeAction?.();
  }
}

/** Port of `IEventHandlerFactory`. */
export interface IEventHandlerFactory {
  getHandler(): IEventHandlerDisposeWrapper;
  isInFactories(handlerFactories: readonly IEventHandlerFactory[]): boolean;
}

export function isEventHandlerFactory(value: unknown): value is IEventHandlerFactory {
  return typeof value === "object" && value !== null && typeof (value as IEventHandlerFactory).getHandler === "function" && typeof (value as IEventHandlerFactory).isInFactories === "function";
}

/** Port of `EventTypeWithEventHandlerFactories`. */
export class EventTypeWithEventHandlerFactories {
  constructor(
    readonly eventType: EventType,
    readonly eventHandlerFactories: IEventHandlerFactory[],
  ) {}
}

/**
 * Replacement for implementing `ILocalEventHandler<TEvent>` / `IDistributedEventHandler<TEvent>`: interfaces vanish
 * at runtime, so a handler class declares the event classes it handles with `@LocalEventHandler(EventA, EventB)`.
 * Declarations are inherited by subclasses, like the interfaces they replace.
 */
export interface EventHandlerMarker {
  (...eventTypes: EventType[]): (target: Class) => void;
  add(handlerType: Class, ...eventTypes: EventType[]): void;
  getEventTypes(handlerType: AbstractClass | undefined): readonly EventType[];
  has(handlerType: AbstractClass | undefined): boolean;
  readonly markerName: string;
}

export function createEventHandlerMarker(name: string): EventHandlerMarker {
  const declared = new WeakMap<object, EventType[]>();
  const add = (handlerType: Class, ...eventTypes: EventType[]): void => {
    const list = declared.get(handlerType) ?? [];
    for (const eventType of eventTypes) if (!list.includes(eventType)) list.push(eventType);
    declared.set(handlerType, list);
  };
  const getEventTypes = (handlerType: AbstractClass | undefined): readonly EventType[] => {
    const result: EventType[] = [];
    let current: unknown = handlerType;
    while (typeof current === "function" && current !== Function.prototype) {
      for (const eventType of declared.get(current) ?? []) if (!result.includes(eventType)) result.push(eventType);
      current = Object.getPrototypeOf(current);
    }
    return result;
  };
  const decorator = (...eventTypes: EventType[]) => (target: Class) => add(target, ...eventTypes);
  return Object.assign(decorator, { add, getEventTypes, has: (t: AbstractClass | undefined) => getEventTypes(t).length > 0, markerName: name });
}

export const LocalEventHandler = createEventHandlerMarker("ILocalEventHandler");
export const DistributedEventHandler = createEventHandlerMarker("IDistributedEventHandler");

const handlerOrders = new WeakMap<object, number>();

/** Port of `[LocalEventHandlerOrder(n)]`: handlers execute in ascending order (inherited). */
export function LocalEventHandlerOrder(order: number) {
  return (target: AbstractClass): void => {
    handlerOrders.set(target, order);
  };
}

export function getLocalEventHandlerOrder(handlerType: AbstractClass | undefined): number {
  let current: unknown = handlerType;
  while (typeof current === "function" && current !== Function.prototype) {
    const order = handlerOrders.get(current);
    if (order !== undefined) return order;
    current = Object.getPrototypeOf(current);
  }
  return 0;
}

/** Port of `IEventHandlerInvoker`. */
export interface IEventHandlerInvoker {
  invoke(eventHandler: IEventHandler, eventData: unknown, eventType: EventType): Promise<void>;
}
export const IEventHandlerInvoker = createToken<IEventHandlerInvoker>("IEventHandlerInvoker");

/** Port of `EventHandlerInvoker`: without generic interfaces the only check left is the presence of `handleEvent`. */
@Singleton(IEventHandlerInvoker)
export class EventHandlerInvoker implements IEventHandlerInvoker {
  async invoke(eventHandler: IEventHandler, eventData: unknown): Promise<void> {
    if (!isEventHandler(eventHandler)) {
      throw new AbpException(`The object instance is not an event handler. Object type: ${(eventHandler as object)?.constructor?.name ?? typeof eventHandler}`);
    }
    await eventHandler.handleEvent(eventData);
  }
}
