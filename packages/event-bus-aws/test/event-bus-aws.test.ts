import { PublishBatchCommand, PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import type { SQSRecord } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Singleton, Transient, type Guid } from "@abp/core";
import {
  AbpDistributedEventBusOptions,
  DistributedEventHandler,
  EtoBase,
  EventName,
  ICorrelationIdProvider,
  IDistributedEventBus,
  InboxProcessManager,
  IncomingEventStatus,
  LocalDistributedEventBus,
  OutboxSenderManager,
  OutgoingEventInfo,
  type DynamicEventData,
  type IEventInbox,
  type IEventOutbox,
  type IIncomingEventInfo,
  type IOutgoingEventInfo,
  type IncomingEventInfo,
} from "@abp/event-bus";
import { ICurrentTenant, type IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import { AbpAwsEventBusOptions, AbpEventBusAwsModule, AwsDistributedEventBus, createSqsEventsHandler, parseSqsEventRecord } from "../src/index.js";

const snsMock = mockClient(SNSClient);
const tenantId: Guid = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const topicArn = "arn:aws:sns:eu-west-1:123456789012:events";

@EventName("orders.created")
class OrderCreatedEto extends EtoBase implements IMultiTenant {
  constructor(
    readonly orderId: string,
    readonly tenantId: Guid | null = null,
  ) {
    super();
  }
}

@Transient()
@DistributedEventHandler(OrderCreatedEto)
class OrderCreatedHandler {
  static received: { orderId: string; tenantId: string | undefined; correlationId: string | undefined }[] = [];
  static readonly inject = [ICurrentTenant, ICorrelationIdProvider] as const;
  constructor(
    private readonly currentTenant: ICurrentTenant,
    private readonly correlationIdProvider: ICorrelationIdProvider,
  ) {}
  async handleEvent(eventData: OrderCreatedEto): Promise<void> {
    if (eventData.orderId === "boom") throw new Error("handler failed");
    OrderCreatedHandler.received.push({ orderId: eventData.orderId, tenantId: this.currentTenant.id, correlationId: this.correlationIdProvider.get() });
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
  async enqueue(incomingEvent: IncomingEventInfo): Promise<void> {
    this.events.push(incomingEvent);
  }
  async getWaitingEvents(maxCount: number, filter?: (e: IIncomingEventInfo) => boolean): Promise<IncomingEventInfo[]> {
    return this.events.filter((e) => e.status === IncomingEventStatus.Pending && (filter?.(e) ?? true)).slice(0, maxCount);
  }
  async markAsProcessed(id: Guid): Promise<void> {
    this.events.find((e) => e.id === id)!.status = IncomingEventStatus.Processed;
  }
  async retryLater(): Promise<void> {}
  async markAsDiscard(id: Guid): Promise<void> {
    this.events.find((e) => e.id === id)!.status = IncomingEventStatus.Discarded;
  }
  async existsByMessageId(messageId: string): Promise<boolean> {
    return this.events.some((e) => e.messageId === messageId);
  }
  async deleteOldEvents(): Promise<void> {}
}

@DependsOn(AbpEventBusAwsModule)
class TestModule extends AbpModule {
  static useOutbox = false;
  static useInbox = false;
  override configureServices(): void {
    this.configure(AbpDistributedEventBusOptions, (options) => {
      if (TestModule.useOutbox) options.outboxes.configure((c) => (c.implementationType = MemoryEventOutbox));
      if (TestModule.useInbox) options.inboxes.configure((c) => (c.implementationType = MemoryEventInbox));
    });
  }
}

async function createApp(values: Record<string, unknown> = { EventBus: { Aws: { TopicArn: topicArn, QueueUrl: "https://sqs/events" } } }) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

function rawRecord(messageId: string, body: string, attributes: Record<string, string>): SQSRecord {
  const messageAttributes = Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, { stringValue: v, dataType: "String" }]));
  return { messageId, receiptHandle: "r", body, attributes: {}, messageAttributes, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn", awsRegion: "eu-west-1" } as unknown as SQSRecord;
}

function envelopeRecord(messageId: string, message: string, attributes: Record<string, string>): SQSRecord {
  const MessageAttributes = Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, { Type: "String", Value: v }]));
  return rawRecord(messageId, JSON.stringify({ Type: "Notification", MessageId: `sns-${messageId}`, Message: message, MessageAttributes }), {});
}

describe("AWS distributed event bus", () => {
  beforeEach(() => {
    snsMock.reset();
    OrderCreatedHandler.received = [];
    TestModule.useOutbox = false;
    TestModule.useInbox = false;
  });

  it("replaces the local distributed event bus and binds EventBus:Aws options", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(IDistributedEventBus);
    expect(bus).toBeInstanceOf(AwsDistributedEventBus);
    expect(bus).not.toBeInstanceOf(LocalDistributedEventBus);
    expect(bus).toBe(app.serviceProvider.getRequired(AwsDistributedEventBus));
    expect(app.serviceProvider.getOptions(AbpAwsEventBusOptions)).toMatchObject({ topicArn, queueUrl: "https://sqs/events" });
  });

  it("publishes to SNS with eventName, correlationId and tenantId attributes", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(IDistributedEventBus);
    snsMock.on(PublishCommand).resolves({ MessageId: "sns-1" });

    const correlation = app.serviceProvider.getRequired(ICorrelationIdProvider);
    await correlation.run("corr-1", () => bus.publish(new OrderCreatedEto("o-1"), false));
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.TopicArn).toBe(topicArn);
    expect(JSON.parse(input.Message!)).toMatchObject({ orderId: "o-1" });
    expect(input.MessageAttributes?.["eventName"]).toEqual({ DataType: "String", StringValue: "orders.created" });
    expect(input.MessageAttributes?.["correlationId"]).toEqual({ DataType: "String", StringValue: "corr-1" });
    expect(input.MessageAttributes?.["tenantId"]).toBeUndefined();
    expect(input.MessageAttributes?.["messageId"]?.StringValue).toMatch(/^[0-9a-f-]{36}$/);

    await app.serviceProvider.getRequired(ICurrentTenant).run(tenantId, undefined, () => bus.publish("dynamic.event", { value: 1 }, false));
    const dynamic = snsMock.commandCalls(PublishCommand)[1]!.args[0].input;
    expect(dynamic.MessageAttributes?.["eventName"]?.StringValue).toBe("dynamic.event");
    expect(dynamic.MessageAttributes?.["tenantId"]?.StringValue).toBe(tenantId);
    expect(JSON.parse(dynamic.Message!)).toEqual({ value: 1 });
  });

  it("fails clearly without a topic arn", async () => {
    const app = await createApp({});
    await expect(app.serviceProvider.getRequired(IDistributedEventBus).publish(new OrderCreatedEto("x"), false)).rejects.toThrow("topicArn is not configured");
  });

  it("dispatches incoming SQS records (raw and enveloped) to handlers under the tenant and correlation id, reporting failures", async () => {
    const app = await createApp();
    const handler = createSqsEventsHandler(() => app);
    const response = await handler({
      Records: [
        rawRecord("raw", JSON.stringify({ orderId: "o-raw", tenantId }), { eventName: "orders.created", correlationId: "c-raw", tenantId }),
        envelopeRecord("env", JSON.stringify({ orderId: "o-env" }), { eventName: "orders.created" }),
        rawRecord("unknown-event", "{}", { eventName: "nobody.listens" }),
        rawRecord("fail", JSON.stringify({ orderId: "boom" }), { eventName: "orders.created" }),
        rawRecord("no-attr", "{}", {}),
      ],
    });
    expect(response.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(["fail", "no-attr"]);
    expect(OrderCreatedHandler.received).toEqual([
      { orderId: "o-raw", tenantId, correlationId: "c-raw" },
      { orderId: "o-env", tenantId: undefined, correlationId: undefined },
    ]);
    expect(app.serviceProvider.getRequired(ICurrentTenant).id).toBeUndefined();
    expect(parseSqsEventRecord(envelopeRecord("m", "{}", { eventName: "e" })).messageId).toBe("sns-m");
  });

  it("delivers dynamic (name-only) subscriptions", async () => {
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(IDistributedEventBus);
    const received: DynamicEventData[] = [];
    bus.subscribe("dynamic.event", async (data: DynamicEventData) => {
      received.push(data);
    });
    await createSqsEventsHandler(() => app)({ Records: [rawRecord("d", JSON.stringify({ value: 7 }), { eventName: "dynamic.event", tenantId })] });
    expect(received).toHaveLength(1);
    expect(received[0]!.data).toEqual({ value: 7 });
    expect(received[0]!.isMultiTenant()).toEqual({ isMultiTenant: true, tenantId });
  });

  it("stores events in the outbox inside a unit of work and publishes them in SNS batches", async () => {
    TestModule.useOutbox = true;
    const app = await createApp();
    const bus = app.serviceProvider.getRequired(IDistributedEventBus);
    const outbox = app.serviceProvider.getRequired(MemoryEventOutbox);
    snsMock.on(PublishBatchCommand).resolves({ Successful: [], Failed: [] });

    const uowManager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const uow = uowManager.begin({}, true);
    await bus.publish(new OrderCreatedEto("o-box"));
    await bus.publish(new OrderCreatedEto("o-box-2"));
    await uow.complete();
    await uow.dispose();
    expect(outbox.events).toHaveLength(2);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);

    const sent = await app.serviceProvider.getRequired(OutboxSenderManager).runOnce();
    expect(sent).toBe(2);
    expect(outbox.events).toHaveLength(0);
    const batch = snsMock.commandCalls(PublishBatchCommand)[0]!.args[0].input;
    expect(batch.TopicArn).toBe(topicArn);
    expect(batch.PublishBatchRequestEntries).toHaveLength(2);
    expect(batch.PublishBatchRequestEntries![0]!.MessageAttributes?.["eventName"]?.StringValue).toBe("orders.created");
    expect(JSON.parse(batch.PublishBatchRequestEntries![0]!.Message!)).toMatchObject({ orderId: "o-box" });

    snsMock.on(PublishBatchCommand).resolves({ Failed: [{ Id: "x", Code: "Throttled", SenderFault: false }] });
    await expect(bus.publish(new OrderCreatedEto("later"), false)).resolves.toBeUndefined();
    const single = new OutgoingEventInfo("00000000-0000-4000-8000-000000000001", "orders.created", JSON.stringify({ orderId: "f" }), new Date());
    await expect(app.serviceProvider.getRequired(AwsDistributedEventBus).publishManyFromOutbox([single], { name: "Default" } as never)).rejects.toThrow("Throttled");
  });

  it("stores incoming events in the inbox when configured and processes them from there", async () => {
    TestModule.useInbox = true;
    const app = await createApp();
    const inbox = app.serviceProvider.getRequired(MemoryEventInbox);
    const handler = createSqsEventsHandler(() => app);

    await handler({ Records: [rawRecord("in-1", JSON.stringify({ orderId: "o-in", tenantId }), { eventName: "orders.created", messageId: "msg-1", tenantId })] });
    expect(OrderCreatedHandler.received).toHaveLength(0);
    expect(inbox.events).toHaveLength(1);
    expect(inbox.events[0]!.messageId).toBe("msg-1");
    expect(inbox.events[0]!.getTenantId()).toBe(tenantId);

    await handler({ Records: [rawRecord("in-2", JSON.stringify({ orderId: "o-in" }), { eventName: "orders.created", messageId: "msg-1" })] });
    expect(inbox.events).toHaveLength(1);

    const processed = await app.serviceProvider.getRequired(InboxProcessManager).runOnce();
    expect(processed).toBe(1);
    expect(inbox.events[0]!.status).toBe(IncomingEventStatus.Processed);
    expect(OrderCreatedHandler.received).toEqual([{ orderId: "o-in", tenantId, correlationId: undefined }]);
  });
});
