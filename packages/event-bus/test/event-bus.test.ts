import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Singleton, Transient, type Guid } from "@abp/core";
import { ICurrentTenant, type IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import {
  AbpDistributedEventBusOptions,
  AbpEventBusBoxesOptions,
  AbpEventBusModule,
  AggregateException,
  DistributedEventHandler,
  DistributedEventReceived,
  DistributedEventSent,
  DistributedEventSource,
  EtoBase,
  EventName,
  EventNameAttribute,
  IDistributedEventBus,
  ILocalEventBus,
  InboxProcessManager,
  InboxProcessorFailurePolicy,
  IncomingEventStatus,
  LocalEventHandler,
  LocalEventHandlerOrder,
  OutboxSenderManager,
  type DynamicEventData,
  type IEventInbox,
  type IEventOutbox,
  type ILocalEventHandler,
  type IIncomingEventInfo,
  type IOutgoingEventInfo,
  type IncomingEventInfo,
  type OutgoingEventInfo,
} from "../src/index.js";

const log: string[] = [];
const tenantA: Guid = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

class ProductEvent {
  constructor(readonly name: string) {}
}
class ProductCreatedEvent extends ProductEvent {}

@Transient()
@LocalEventHandler(ProductEvent)
@LocalEventHandlerOrder(2)
class ProductEventHandler implements ILocalEventHandler<ProductEvent> {
  async handleEvent(eventData: ProductEvent): Promise<void> {
    log.push(`base:${eventData.name}`);
  }
}

@Transient()
@LocalEventHandler(ProductCreatedEvent)
@LocalEventHandlerOrder(1)
class ProductCreatedEventHandler implements ILocalEventHandler<ProductCreatedEvent> {
  async handleEvent(eventData: ProductCreatedEvent): Promise<void> {
    log.push(`created:${eventData.name}`);
  }
}

class TenantEvent implements IMultiTenant {
  constructor(readonly tenantId: Guid | undefined) {}
}

@Transient()
@LocalEventHandler(TenantEvent)
class TenantEventHandler implements ILocalEventHandler<TenantEvent> {
  static readonly inject = [ICurrentTenant] as const;
  constructor(private readonly currentTenant: ICurrentTenant) {}
  async handleEvent(): Promise<void> {
    log.push(`tenant:${this.currentTenant.id ?? "host"}`);
  }
}

@EventName("orders.created")
class OrderCreatedEto extends EtoBase {
  constructor(
    readonly orderId: string,
    readonly createdAt: Date,
  ) {
    super();
  }
}

@Transient()
@DistributedEventHandler(OrderCreatedEto)
class OrderCreatedHandler {
  static received: OrderCreatedEto[] = [];
  async handleEvent(eventData: OrderCreatedEto): Promise<void> {
    OrderCreatedHandler.received.push(eventData);
  }
}

@Singleton()
class MemoryEventOutbox implements IEventOutbox {
  readonly events: OutgoingEventInfo[] = [];
  async enqueue(outgoingEvent: OutgoingEventInfo): Promise<void> {
    this.events.push(outgoingEvent);
  }
  async getWaitingEvents(maxCount: number, filter?: (e: IOutgoingEventInfo) => boolean): Promise<OutgoingEventInfo[]> {
    return this.events.filter((e) => filter?.(e) ?? true).slice(0, maxCount);
  }
  async delete(id: Guid): Promise<void> {
    await this.deleteMany([id]);
  }
  async deleteMany(ids: readonly Guid[]): Promise<void> {
    for (let i = this.events.length - 1; i >= 0; i--) if (ids.includes(this.events[i]!.id)) this.events.splice(i, 1);
  }
}

@Singleton()
class MemoryEventInbox implements IEventInbox {
  readonly events: IncomingEventInfo[] = [];
  deletedOldEvents = 0;
  async enqueue(incomingEvent: IncomingEventInfo): Promise<void> {
    this.events.push(incomingEvent);
  }
  async getWaitingEvents(maxCount: number, filter?: (e: IIncomingEventInfo) => boolean): Promise<IncomingEventInfo[]> {
    return this.events.filter((e) => e.status === IncomingEventStatus.Pending && e.nextRetryTime === undefined && (filter?.(e) ?? true)).slice(0, maxCount);
  }
  async markAsProcessed(id: Guid): Promise<void> {
    this.find(id).status = IncomingEventStatus.Processed;
  }
  async retryLater(id: Guid, retryCount: number, nextRetryTime: Date | undefined): Promise<void> {
    const e = this.find(id);
    e.retryCount = retryCount;
    e.nextRetryTime = nextRetryTime;
  }
  async markAsDiscard(id: Guid): Promise<void> {
    this.find(id).status = IncomingEventStatus.Discarded;
  }
  async existsByMessageId(messageId: string): Promise<boolean> {
    return this.events.some((e) => e.messageId === messageId);
  }
  async deleteOldEvents(): Promise<void> {
    this.deletedOldEvents++;
  }
  private find(id: Guid): IncomingEventInfo {
    return this.events.find((e) => e.id === id)!;
  }
}

@DependsOn(AbpEventBusModule)
class TestModule extends AbpModule {}

@DependsOn(AbpEventBusModule)
class OutboxTestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpDistributedEventBusOptions, (options) => {
      options.outboxes.configure((outbox) => {
        outbox.databaseName = "Default";
        outbox.implementationType = MemoryEventOutbox;
      });
    });
  }
}

@DependsOn(AbpEventBusModule)
class InboxTestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpDistributedEventBusOptions, (options) => {
      options.inboxes.configure((inbox) => {
        inbox.databaseName = "Default";
        inbox.implementationType = MemoryEventInbox;
      });
    });
    this.configure(AbpEventBusBoxesOptions, (options) => {
      options.inboxProcessorFailurePolicy = InboxProcessorFailurePolicy.RetryLater;
    });
  }
}

async function createApp(module: typeof TestModule = TestModule) {
  log.length = 0;
  OrderCreatedHandler.received = [];
  const app = await AbpApplication.create(module, { configuration: { skipDefaults: true } });
  await app.initialize();
  return app;
}

describe("LocalEventBus", () => {
  it("auto-subscribes registered classes that declare handled events", () => {
    expect(LocalEventHandler.getEventTypes(ProductEventHandler)).toEqual([ProductEvent]);
    expect(LocalEventHandler.getEventTypes(ProductCreatedEventHandler)).toEqual([ProductCreatedEvent]);
    expect(LocalEventHandler.getEventTypes(TenantEventHandler)).toEqual([TenantEvent]);
    expect(LocalEventHandler.has(OrderCreatedHandler)).toBe(false);
    expect(DistributedEventHandler.getEventTypes(OrderCreatedHandler)).toEqual([OrderCreatedEto]);
  });

  it("dispatches to handlers of the event class and its base classes in LocalEventHandlerOrder", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(ILocalEventBus);

    await bus.publish(new ProductCreatedEvent("book"));
    expect(log).toEqual(["created:book", "base:book"]);

    log.length = 0;
    await bus.publish(new ProductEvent("pen"));
    expect(log).toEqual(["base:pen"]);
    await app.shutdown();
  });

  it("supports action, instance and class subscriptions with unsubscribe", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(ILocalEventBus);
    const seen: string[] = [];
    const action = async (e: ProductEvent) => {
      seen.push(`action:${e.name}`);
    };
    const instance = { handleEvent: async (e: ProductEvent) => void seen.push(`instance:${e.name}`) };
    class Transient {
      async handleEvent(e: ProductEvent): Promise<void> {
        seen.push(`class:${e.name}`);
      }
    }

    const subscription = bus.subscribe(ProductEvent, action);
    bus.subscribe(ProductEvent, instance);
    bus.subscribe(ProductEvent, Transient);
    await bus.publish(new ProductEvent("a"));
    expect(seen).toEqual(["action:a", "instance:a", "class:a"]);

    subscription[Symbol.dispose]();
    bus.unsubscribe(ProductEvent, instance);
    bus.unsubscribe(ProductEvent, Transient);
    await bus.publish(new ProductEvent("b"));
    expect(seen).toEqual(["action:a", "instance:a", "class:a"]);
    expect(bus.getEventHandlerFactories(ProductEvent).length).toBe(1);
    await app.shutdown();
  });

  it("defers publishing to unit of work completion", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(ILocalEventBus);
    const uowManager = app.serviceProvider.getRequired(IUnitOfWorkManager);

    const uow = uowManager.begin();
    try {
      await bus.publish(new ProductCreatedEvent("deferred"));
      await bus.publish(new ProductEvent("immediate"), false);
      expect(log).toEqual(["base:immediate"]);
      await uow.complete();
      expect(log).toEqual(["base:immediate", "created:deferred", "base:deferred"]);
    } finally {
      await uow.dispose();
    }

    const failing = uowManager.begin();
    await bus.publish(new ProductEvent("rolled-back"));
    await failing.dispose();
    expect(log).toEqual(["base:immediate", "created:deferred", "base:deferred"]);
    await app.shutdown();
  });

  it("runs handlers in the tenant of IMultiTenant events", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(ILocalEventBus);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);

    await bus.publish(new TenantEvent(tenantA));
    await currentTenant.run(tenantA, undefined, () => bus.publish(new TenantEvent(undefined)));
    await currentTenant.run(tenantA, undefined, () => bus.publish(new ProductEvent("x")));
    expect(log).toEqual([`tenant:${tenantA}`, "tenant:host", "base:x"]);
    expect(currentTenant.id).toBeUndefined();
    await app.shutdown();
  });

  it("aggregates handler exceptions", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(ILocalEventBus);
    bus.subscribe(TenantEvent, async () => {
      throw new Error("first");
    });
    await expect(bus.publish(new TenantEvent(undefined))).rejects.toThrow("first");

    bus.subscribe(TenantEvent, async () => {
      throw new Error("second");
    });
    const error = await bus.publish(new TenantEvent(undefined)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateException);
    expect((error as AggregateException).innerExceptions.map((e) => (e as Error).message)).toEqual(["first", "second"]);
    await app.shutdown();
  });

  it("publishes by event name, converting dynamic data to the registered class", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(ILocalEventBus);
    const dynamic: DynamicEventData[] = [];
    bus.subscribe("unknown.event", async (e: DynamicEventData) => void dynamic.push(e));

    await bus.publish("ProductCreatedEvent", { name: "named" });
    expect(log).toEqual(["created:named", "base:named"]);

    await bus.publish("unknown.event", { id: 1 });
    expect(dynamic[0]?.eventName).toBe("unknown.event");
    expect(dynamic[0]?.data).toEqual({ id: 1 });
    await app.shutdown();
  });
});

describe("EventName", () => {
  it("resolves declared names, defaults to the class name and rejects blank names", () => {
    expect(EventNameAttribute.getNameOrDefault(OrderCreatedEto)).toBe("orders.created");
    expect(EventNameAttribute.getNameOrDefault(ProductEvent)).toBe("ProductEvent");
    class Sub extends OrderCreatedEto {}
    expect(EventNameAttribute.getNameOrDefault(Sub)).toBe("orders.created");
    expect(() => EventName(" ")).toThrow();
  });
});

describe("LocalDistributedEventBus", () => {
  it("triggers auto-subscribed distributed handlers and DistributedEventSent/Received local events", async () => {
    const app = await createApp();
    const distributedBus = app.serviceProvider.getRequired(IDistributedEventBus);
    const localBus = app.serviceProvider.getRequired(ILocalEventBus);
    const notifications: string[] = [];
    localBus.subscribe(DistributedEventSent, async (e: DistributedEventSent) => void notifications.push(`sent:${e.source}:${e.eventName}`));
    localBus.subscribe(DistributedEventReceived, async (e: DistributedEventReceived) => void notifications.push(`received:${e.source}:${e.eventName}`));

    await distributedBus.publish(new OrderCreatedEto("o1", new Date()));
    expect(OrderCreatedHandler.received.map((e) => e.orderId)).toEqual(["o1"]);
    expect(notifications).toEqual([`sent:${DistributedEventSource.Direct}:orders.created`, `received:${DistributedEventSource.Direct}:orders.created`]);
    await app.shutdown();
  });

  it("stores events in the outbox inside a unit of work and OutboxSender.runOnce delivers them with a JSON round trip", async () => {
    const app = await createApp(OutboxTestModule);
    const distributedBus = app.serviceProvider.getRequired(IDistributedEventBus);
    const uowManager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const outbox = app.serviceProvider.getRequired(MemoryEventOutbox);
    const createdAt = new Date("2024-05-06T07:08:09.123Z");

    const uow = uowManager.begin();
    try {
      await distributedBus.publish(new OrderCreatedEto("o2", createdAt));
      expect(outbox.events.length).toBe(0);
      await uow.complete();
    } finally {
      await uow.dispose();
    }
    expect(OrderCreatedHandler.received).toEqual([]);
    expect(outbox.events.length).toBe(1);
    expect(outbox.events[0]?.eventName).toBe("orders.created");
    expect(JSON.parse(outbox.events[0]!.eventData)).toEqual({ orderId: "o2", createdAt: createdAt.toISOString(), properties: {} });

    const sent = await app.serviceProvider.getRequired(OutboxSenderManager).runOnce();
    expect(sent).toBe(1);
    expect(outbox.events.length).toBe(0);
    expect(OrderCreatedHandler.received.length).toBe(1);
    const received = OrderCreatedHandler.received[0]!;
    expect(received).toBeInstanceOf(OrderCreatedEto);
    expect(received.orderId).toBe("o2");
    expect(received.createdAt).toBeInstanceOf(Date);
    expect(received.createdAt.getTime()).toBe(createdAt.getTime());
    await app.shutdown();
  });

  it("stores incoming events in the inbox and InboxProcessor.runOnce handles them with retry-later on failure", async () => {
    const app = await createApp(InboxTestModule);
    const distributedBus = app.serviceProvider.getRequired(IDistributedEventBus);
    const inbox = app.serviceProvider.getRequired(MemoryEventInbox);
    const manager = app.serviceProvider.getRequired(InboxProcessManager);

    await distributedBus.publish(new OrderCreatedEto("o3", new Date()));
    expect(OrderCreatedHandler.received).toEqual([]);
    expect(inbox.events.length).toBe(1);
    expect(inbox.events[0]?.status).toBe(IncomingEventStatus.Pending);

    expect(await manager.runOnce()).toBe(1);
    expect(inbox.events[0]?.status).toBe(IncomingEventStatus.Processed);
    expect(inbox.deletedOldEvents).toBe(1);
    expect(OrderCreatedHandler.received.map((e) => e.orderId)).toEqual(["o3"]);

    distributedBus.subscribe(OrderCreatedEto, async () => {
      throw new Error("handler failed");
    });
    await distributedBus.publish(new OrderCreatedEto("o4", new Date()));
    expect(await manager.runOnce()).toBe(1);
    expect(inbox.events[1]?.status).toBe(IncomingEventStatus.Pending);
    expect(inbox.events[1]?.nextRetryTime).toBeInstanceOf(Date);
    expect(OrderCreatedHandler.received.map((e) => e.orderId)).toEqual(["o3", "o4"]);
    await app.shutdown();
  });
});
