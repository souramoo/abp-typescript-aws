import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { optionsToken, type Class, type Guid, type IOptions, type ServiceKey } from "@abp/core";
import { getConnectionStringName } from "@abp/data";
import { AbpEventBusBoxesOptions, IncomingEventInfo, IncomingEventStatus, OutgoingEventInfo, type IEventInbox, type IEventOutbox, type IIncomingEventInfo, type IOutgoingEventInfo } from "@abp/event-bus";
import { IClock } from "@abp/timing";
import { UnitOfWork } from "@abp/uow";
import { AbpDynamoDbConsts } from "./abp-dynamodb-consts.js";
import type { AbpDynamoDbContext } from "./abp-dynamodb-context.js";
import { dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "./dynamodb-context-provider.js";
import { NoCondition, type DynamoDbDatabase } from "./dynamodb-database.js";
import type { DynamoDbItem } from "./dynamodb-entity-serializer.js";
import { indexAttributeNames, type DynamoDbItemKey } from "./dynamodb-keys.js";

/*
 * Ports of `MongoDbContextEventOutbox`/`MongoDbContextEventInbox`. Records are plain items of the context's table:
 *   outbox: pk = <prefix>outbox#<id>, sk = outbox, gsi1pk = <prefix>outbox#<databaseName>, gsi1sk = <creationTime ISO>#<id>
 *   inbox:  pk = <prefix>inbox#<id>,  sk = inbox,  gsi1pk = <prefix>inbox#<databaseName>,  gsi1sk = <creationTime ISO>#<id>,
 *           gsi2pk = <prefix>inbox#<databaseName>#message#<messageId>
 * `databaseName` is the connection string name of the context (what `eventOutboxToken(name)` is keyed by).
 */

const OutboxSortKey = "outbox";
const InboxSortKey = "inbox";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraPropertiesOf(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

interface BoxItemFields {
  readonly id: string;
  readonly eventName: string;
  readonly eventData: string;
  readonly creationTime: Date;
}

function readBoxItem(item: unknown): (BoxItemFields & Record<string, unknown>) | undefined {
  if (!isRecord(item)) return undefined;
  const { id, eventName, eventData, creationTime } = item;
  if (typeof id !== "string" || typeof eventName !== "string" || typeof eventData !== "string" || typeof creationTime !== "string") return undefined;
  const time = new Date(creationTime);
  if (Number.isNaN(time.getTime())) return undefined;
  return { ...item, id, eventName, eventData, creationTime: time };
}

function toOutgoingEventInfo(item: unknown): OutgoingEventInfo | undefined {
  const fields = readBoxItem(item);
  if (!fields) return undefined;
  const info = new OutgoingEventInfo(fields.id, fields.eventName, fields.eventData, fields.creationTime);
  for (const [key, value] of extraPropertiesOf(fields["extraProperties"])) info.extraProperties.set(key, value);
  return info;
}

function toIncomingEventInfo(item: unknown): IncomingEventInfo | undefined {
  const fields = readBoxItem(item);
  if (!fields) return undefined;
  const messageId = typeof fields["messageId"] === "string" ? fields["messageId"] : "";
  const status = typeof fields["status"] === "number" ? (fields["status"] as IncomingEventStatus) : IncomingEventStatus.Pending;
  const handledTime = typeof fields["handledTime"] === "string" ? new Date(fields["handledTime"]) : undefined;
  const retryCount = typeof fields["retryCount"] === "number" ? fields["retryCount"] : 0;
  const nextRetryTime = typeof fields["nextRetryTime"] === "string" ? new Date(fields["nextRetryTime"]) : undefined;
  const info = new IncomingEventInfo(fields.id, messageId, fields.eventName, fields.eventData, fields.creationTime, status, handledTime, retryCount, nextRetryTime);
  for (const [key, value] of extraPropertiesOf(fields["extraProperties"])) info.extraProperties.set(key, value);
  return info;
}

function boxKey(database: DynamoDbDatabase, box: string, id: Guid): DynamoDbItemKey {
  return { pk: `${database.options.keyPrefix}${box}#${id}`, sk: box };
}

function boxListPartitionKey(database: DynamoDbDatabase, box: string, databaseName: string): string {
  return `${database.options.keyPrefix}${box}#${databaseName}`;
}

interface BoxQuery {
  readonly partitionKey: string;
  readonly filterExpression?: string;
  readonly names?: Record<string, string>;
  readonly values?: Record<string, unknown>;
}

async function queryBox(database: DynamoDbDatabase, query: BoxQuery, maxCount: number, accept: (item: DynamoDbItem) => boolean, signal?: AbortSignal): Promise<DynamoDbItem[]> {
  const gsi1 = indexAttributeNames("gsi1");
  const results: DynamoDbItem[] = [];
  let startKey: Record<string, unknown> | undefined = undefined;
  do {
    const response = await database.query(
      {
        IndexName: database.keyBuilder.indexName("gsi1"),
        KeyConditionExpression: "#pk = :pk",
        FilterExpression: query.filterExpression,
        ExpressionAttributeNames: { "#pk": gsi1.pk, ...query.names },
        ExpressionAttributeValues: { ":pk": query.partitionKey, ...query.values },
        ScanIndexForward: true,
        Limit: Math.max(1, maxCount - results.length),
        ExclusiveStartKey: startKey,
      },
      signal,
    );
    for (const item of response.Items ?? []) {
      if (!accept(item)) continue;
      results.push(item);
      if (results.length >= maxCount) break;
    }
    startKey = response.LastEvaluatedKey;
  } while (startKey !== undefined && results.length < maxCount);
  return results;
}

/** Port of `MongoDbContextEventOutbox<TMongoDbContext>`; every method runs in a unit of work (`[UnitOfWork]`). */
@UnitOfWork()
export class DynamoDbEventOutbox<TDbContext extends AbpDynamoDbContext = AbpDynamoDbContext> implements IEventOutbox {
  static readonly inject: readonly ServiceKey[] = [];

  constructor(
    protected readonly dbContextProvider: IDynamoDbContextProvider<TDbContext>,
    readonly databaseName: string,
  ) {}

  async enqueue(outgoingEvent: OutgoingEventInfo): Promise<void> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    const key = boxKey(database, OutboxSortKey, outgoingEvent.id);
    const gsi1 = indexAttributeNames("gsi1");
    database.put(
      key,
      {
        ...key,
        [gsi1.pk]: boxListPartitionKey(database, OutboxSortKey, this.databaseName),
        [gsi1.sk]: `${outgoingEvent.creationTime.toISOString()}#${outgoingEvent.id}`,
        [AbpDynamoDbConsts.EntityTypeAttribute]: AbpDynamoDbConsts.OutboxEntityName,
        id: outgoingEvent.id,
        eventName: outgoingEvent.eventName,
        eventData: outgoingEvent.eventData,
        creationTime: outgoingEvent.creationTime.toISOString(),
        extraProperties: Object.fromEntries(outgoingEvent.extraProperties),
      },
      NoCondition,
    );
  }

  async getWaitingEvents(maxCount: number, filter?: (event: IOutgoingEventInfo) => boolean, signal?: AbortSignal): Promise<OutgoingEventInfo[]> {
    const database = (await this.dbContextProvider.getDbContext(signal)).database;
    const events: OutgoingEventInfo[] = [];
    await queryBox(
      database,
      { partitionKey: boxListPartitionKey(database, OutboxSortKey, this.databaseName) },
      maxCount,
      (item) => {
        const info = toOutgoingEventInfo(item);
        if (!info || (filter && !filter(info))) return false;
        events.push(info);
        return true;
      },
      signal,
    );
    return events;
  }

  async delete(id: Guid): Promise<void> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    database.delete(boxKey(database, OutboxSortKey, id), NoCondition);
  }

  async deleteMany(ids: readonly Guid[]): Promise<void> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    for (const id of ids) database.delete(boxKey(database, OutboxSortKey, id), NoCondition);
  }
}

/**
 * Port of `MongoDbContextEventInbox<TMongoDbContext>`. Status changes (`markAsProcessed`, `retryLater`,
 * `markAsDiscard`) are sent immediately as `UpdateItem`s rather than buffered: they are idempotent flags and must
 * not be lost when the processing unit of work rolls back.
 */
@UnitOfWork()
export class DynamoDbEventInbox<TDbContext extends AbpDynamoDbContext = AbpDynamoDbContext> implements IEventInbox {
  static readonly inject: readonly ServiceKey[] = [];
  protected readonly eventBusBoxesOptions: AbpEventBusBoxesOptions;

  constructor(
    protected readonly dbContextProvider: IDynamoDbContextProvider<TDbContext>,
    protected readonly clock: IClock,
    eventBusBoxesOptions: IOptions<AbpEventBusBoxesOptions>,
    readonly databaseName: string,
  ) {
    this.eventBusBoxesOptions = eventBusBoxesOptions.value;
  }

  async enqueue(incomingEvent: IncomingEventInfo): Promise<void> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    const key = boxKey(database, InboxSortKey, incomingEvent.id);
    const gsi1 = indexAttributeNames("gsi1");
    const gsi2 = indexAttributeNames("gsi2");
    database.put(
      key,
      {
        ...key,
        [gsi1.pk]: boxListPartitionKey(database, InboxSortKey, this.databaseName),
        [gsi1.sk]: `${incomingEvent.creationTime.toISOString()}#${incomingEvent.id}`,
        [gsi2.pk]: this.messagePartitionKey(database, incomingEvent.messageId),
        [gsi2.sk]: incomingEvent.id,
        [AbpDynamoDbConsts.EntityTypeAttribute]: AbpDynamoDbConsts.InboxEntityName,
        id: incomingEvent.id,
        messageId: incomingEvent.messageId,
        eventName: incomingEvent.eventName,
        eventData: incomingEvent.eventData,
        creationTime: incomingEvent.creationTime.toISOString(),
        status: incomingEvent.status,
        handledTime: incomingEvent.handledTime?.toISOString() ?? null,
        retryCount: incomingEvent.retryCount,
        nextRetryTime: incomingEvent.nextRetryTime?.toISOString() ?? null,
        extraProperties: Object.fromEntries(incomingEvent.extraProperties),
      },
      NoCondition,
    );
  }

  async getWaitingEvents(maxCount: number, filter?: (event: IIncomingEventInfo) => boolean, signal?: AbortSignal): Promise<IncomingEventInfo[]> {
    const database = (await this.dbContextProvider.getDbContext(signal)).database;
    const now = this.clock.now.toISOString();
    const events: IncomingEventInfo[] = [];
    await queryBox(
      database,
      {
        partitionKey: boxListPartitionKey(database, InboxSortKey, this.databaseName),
        filterExpression: "#status = :pending AND (attribute_not_exists(#nextRetryTime) OR #nextRetryTime = :null OR #nextRetryTime <= :now)",
        names: { "#status": "status", "#nextRetryTime": "nextRetryTime" },
        values: { ":pending": IncomingEventStatus.Pending, ":null": null, ":now": now },
      },
      maxCount,
      (item) => {
        const info = toIncomingEventInfo(item);
        if (!info || (filter && !filter(info))) return false;
        events.push(info);
        return true;
      },
      signal,
    );
    return events;
  }

  async markAsProcessed(id: Guid): Promise<void> {
    await this.updateStatus(id, { status: IncomingEventStatus.Processed, handledTime: this.clock.now.toISOString() });
  }

  async retryLater(id: Guid, retryCount: number, nextRetryTime: Date | undefined): Promise<void> {
    await this.updateStatus(id, { retryCount, nextRetryTime: nextRetryTime?.toISOString() ?? null });
  }

  async markAsDiscard(id: Guid): Promise<void> {
    await this.updateStatus(id, { status: IncomingEventStatus.Discarded, handledTime: this.clock.now.toISOString() });
  }

  async existsByMessageId(messageId: string): Promise<boolean> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    const gsi2 = indexAttributeNames("gsi2");
    const response = await database.query({
      IndexName: database.keyBuilder.indexName("gsi2"),
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": gsi2.pk },
      ExpressionAttributeValues: { ":pk": this.messagePartitionKey(database, messageId) },
      Select: "COUNT",
      Limit: 1,
    });
    return (response.Count ?? 0) > 0;
  }

  async deleteOldEvents(): Promise<void> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    const threshold = new Date(this.clock.now.getTime() - this.eventBusBoxesOptions.waitTimeToDeleteProcessedInboxEventsMs).toISOString();
    const old = await queryBox(
      database,
      {
        partitionKey: boxListPartitionKey(database, InboxSortKey, this.databaseName),
        filterExpression: "(#status = :processed OR #status = :discarded) AND #creationTime < :threshold",
        names: { "#status": "status", "#creationTime": "creationTime" },
        values: { ":processed": IncomingEventStatus.Processed, ":discarded": IncomingEventStatus.Discarded, ":threshold": threshold },
      },
      Number.MAX_SAFE_INTEGER,
      () => true,
    );
    for (const item of old) {
      if (typeof item["id"] === "string") database.delete(boxKey(database, InboxSortKey, item["id"]), NoCondition);
    }
  }

  protected messagePartitionKey(database: DynamoDbDatabase, messageId: string): string {
    return `${boxListPartitionKey(database, InboxSortKey, this.databaseName)}#message#${messageId}`;
  }

  private async updateStatus(id: Guid, values: Record<string, unknown>): Promise<void> {
    const database = (await this.dbContextProvider.getDbContext()).database;
    const names: Record<string, string> = {};
    const attributeValues: Record<string, unknown> = {};
    const assignments: string[] = [];
    for (const [name, value] of Object.entries(values)) {
      names[`#${name}`] = name;
      attributeValues[`:${name}`] = value;
      assignments.push(`#${name} = :${name}`);
    }
    await database.documentClient.send(
      new UpdateCommand({
        TableName: database.tableName,
        Key: { ...boxKey(database, InboxSortKey, id) },
        UpdateExpression: `SET ${assignments.join(", ")}`,
        ConditionExpression: "attribute_exists(#pk)",
        ExpressionAttributeNames: { ...names, "#pk": AbpDynamoDbConsts.PartitionKeyAttribute },
        ExpressionAttributeValues: attributeValues,
      }),
    );
  }
}

const outboxClasses = new WeakMap<object, Class<DynamoDbEventOutbox>>();
const inboxClasses = new WeakMap<object, Class<DynamoDbEventInbox>>();

/** The closed `DynamoDbEventOutbox<TDbContext>` class registered under `eventOutboxToken(<connection string name>)`. */
export function dynamoDbEventOutboxClassFor<TDbContext extends AbpDynamoDbContext>(dbContextType: Class<TDbContext>): Class<DynamoDbEventOutbox<TDbContext>> {
  const existing = outboxClasses.get(dbContextType);
  if (existing) return existing as Class<DynamoDbEventOutbox<TDbContext>>;
  const providerToken = dynamoDbContextProviderToken(dbContextType);
  const databaseName = getConnectionStringName(dbContextType);
  const closed = class extends DynamoDbEventOutbox<TDbContext> {
    static override readonly inject = [providerToken] as const;
    constructor(dbContextProvider: IDynamoDbContextProvider<TDbContext>) {
      super(dbContextProvider, databaseName);
    }
  };
  Object.defineProperty(closed, "name", { value: `DynamoDbEventOutbox<${dbContextType.name}>` });
  outboxClasses.set(dbContextType, closed);
  return closed;
}

/** The closed `DynamoDbEventInbox<TDbContext>` class registered under `eventInboxToken(<connection string name>)`. */
export function dynamoDbEventInboxClassFor<TDbContext extends AbpDynamoDbContext>(dbContextType: Class<TDbContext>): Class<DynamoDbEventInbox<TDbContext>> {
  const existing = inboxClasses.get(dbContextType);
  if (existing) return existing as Class<DynamoDbEventInbox<TDbContext>>;
  const providerToken = dynamoDbContextProviderToken(dbContextType);
  const databaseName = getConnectionStringName(dbContextType);
  const closed = class extends DynamoDbEventInbox<TDbContext> {
    static override readonly inject = [providerToken, IClock, optionsToken(AbpEventBusBoxesOptions)] as const;
    constructor(dbContextProvider: IDynamoDbContextProvider<TDbContext>, clock: IClock, eventBusBoxesOptions: IOptions<AbpEventBusBoxesOptions>) {
      super(dbContextProvider, clock, eventBusBoxesOptions, databaseName);
    }
  };
  Object.defineProperty(closed, "name", { value: `DynamoDbEventInbox<${dbContextType.name}>` });
  inboxClasses.set(dbContextType, closed);
  return closed;
}
