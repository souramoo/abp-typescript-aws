import { Check, describeKey, type AbstractClass } from "@abp/core";
import type { EventType } from "./event-handler.js";

/** Port of `IEventNameProvider`. */
export interface IEventNameProvider {
  getName(eventType: EventType): string;
}

const eventNameProviders = new WeakMap<object, IEventNameProvider>();

/**
 * Port of `EventNameAttribute`. The default name is the class name (there is no `Type.FullName`); like the .NET
 * attribute (`Inherited = true`) a name declared on a base class applies to its subclasses.
 */
export class EventNameAttribute implements IEventNameProvider {
  readonly name: string;

  constructor(name: string) {
    this.name = Check.notNullOrWhiteSpace(name, "name");
  }

  getName(): string {
    return this.name;
  }

  static getNameOrDefault(eventType: EventType | AbstractClass): string {
    Check.notNull(eventType, "eventType");
    return EventNameAttribute.findProvider(eventType)?.getName(eventType as EventType) ?? describeKey(eventType);
  }

  /** Registers a custom `IEventNameProvider` for a class (what applying a provider attribute does in .NET). */
  static setProvider(eventType: AbstractClass, provider: IEventNameProvider): void {
    eventNameProviders.set(eventType, provider);
  }

  private static findProvider(eventType: AbstractClass): IEventNameProvider | undefined {
    let current: unknown = eventType;
    while (typeof current === "function" && current !== Function.prototype) {
      const provider = eventNameProviders.get(current);
      if (provider) return provider;
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  }
}

/** Port of `[EventName("...")]`. */
export function EventName(name: string) {
  const provider = new EventNameAttribute(name);
  return (target: AbstractClass): void => {
    EventNameAttribute.setProvider(target, provider);
  };
}

/**
 * Event name → event class map (the `EventTypes` dictionaries of `LocalEventBus`/`LocalDistributedEventBus`).
 * Needed to turn a serialized distributed event back into an instance of its class.
 */
export class EventTypeRegistry implements Iterable<[string, EventType]> {
  private readonly types = new Map<string, EventType>();

  /** `EventTypes.GetOrAdd(name, type)`: the first class registered under a name wins. Returns the name. */
  add(eventType: EventType): string {
    const name = EventNameAttribute.getNameOrDefault(eventType);
    if (!this.types.has(name)) this.types.set(name, eventType);
    return name;
  }

  getOrDefault(eventName: string): EventType | undefined {
    return this.types.get(eventName);
  }

  has(eventName: string): boolean {
    return this.types.has(eventName);
  }

  [Symbol.iterator](): Iterator<[string, EventType]> {
    return this.types[Symbol.iterator]();
  }
}
