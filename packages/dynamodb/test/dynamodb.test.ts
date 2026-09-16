import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, UpdateTimeToLiveCommand } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpException, AbpModule, DependsOn, Guid, NullLoggerFactory, Transient, createToken, type IServiceProvider } from "@abp/core";
import { AbpAuditingOptions, IAuditingManager } from "@abp/auditing";
import { AbpDbConcurrencyException, ConnectionStringName, IDataFilter, MultiTenantFilter, SoftDeleteFilter } from "@abp/data";
import { AggregateRoot, Entity, EntityCreatedEventData, EntityNotFoundException, FullAuditedAggregateRoot, hardDelete, repositoryToken, type IRepository } from "@abp/ddd-domain";
import { AbpDistributedEventBusOptions, ILocalEventBus, IncomingEventInfo, IncomingEventStatus, OutgoingEventInfo, eventInboxToken, eventOutboxToken } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary } from "@abp/object-extending";
import { IUnitOfWorkManager, type UnitOfWorkOptionsInput } from "@abp/uow";
import {
  AbpDynamoDbContext,
  AbpDynamoDbModule,
  AbpDynamoDbOptions,
  DefaultDynamoDbEntitySerializer,
  DynamoDbEventInbox,
  DynamoDbEventOutbox,
  DynamoDbRepository,
  IDynamoDbTableManager,
  addDynamoDbContext,
  dynamoDbContextProviderToken,
  dynamoDbRepositoryClassFor,
  type DynamoDbModelBuilder,
  type IDynamoDbContextProvider,
} from "../src/index.js";
import { FakeTable } from "./fake-table.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);
const dynamoDbClientMock = mockClient(DynamoDBClient);

class Book extends FullAuditedAggregateRoot<string> {
  title = "";
  price = 0;
  isbn = "";
  tenantId: string | undefined = undefined;
  publishedAt: Date | undefined = undefined;
  tags = new Set<string>();
  expiresAt: Date | undefined = undefined;
  constructor(id?: string, title = "", price = 0) {
    super(id);
    this.title = title;
    this.price = price;
  }
}

class Tag extends Entity<string> {
  name = "";
}

class Category extends AggregateRoot<string> {
  name = "";
}

class Review extends Entity<string> {
  text = "";
}

@ConnectionStringName("BookStore")
class BookStoreDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder
      .entity(Book, (e) => {
        e.index("gsi2", { pk: (b) => b.isbn });
        e.ttl((b) => b.expiresAt);
      })
      .entity(Tag)
      .entity(Category);
  }
}

interface IBookRepository extends IRepository<Book, string> {
  findByIsbn(isbn: string): Promise<Book | undefined>;
}
const IBookRepository = createToken<IBookRepository>("IBookRepository");

@Transient(IBookRepository)
class BookRepository extends DynamoDbRepository<BookStoreDbContext, Book, string> implements IBookRepository {
  static readonly inject = [dynamoDbContextProviderToken(BookStoreDbContext)] as const;
  constructor(dbContextProvider: IDynamoDbContextProvider<BookStoreDbContext>) {
    super(dbContextProvider, Book);
  }
  async findByIsbn(isbn: string): Promise<Book | undefined> {
    return (await this.getDynamoDbQueryable()).usingIndex("gsi2", isbn).firstOrDefault();
  }
}

@DependsOn(AbpDynamoDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    addDynamoDbContext(this.context.services, BookStoreDbContext, (options) => {
      options.addDefaultRepositories().addRepository(Book, BookRepository).addDefaultRepository(Tag).addOutbox().addInbox();
    });
    this.configure(AbpAuditingOptions, (options) => {
      options.entityHistorySelectors.add("Books", (type) => type === Book);
    });
  }
}

const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
let app: AbpApplication;
let provider: IServiceProvider;
let table: FakeTable;

beforeAll(async () => {
  app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { ConnectionStrings: { Default: "abp-table" } } }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  provider = app.serviceProvider;
});
afterAll(() => app.shutdown());

beforeEach(() => {
  table = new FakeTable();
  documentClientMock.reset();
  dynamoDbClientMock.reset();
  documentClientMock.on(GetCommand).callsFake((input) => table.get(input));
  documentClientMock.on(PutCommand).callsFake((input) => table.put(input));
  documentClientMock.on(DeleteCommand).callsFake((input) => table.delete(input));
  documentClientMock.on(UpdateCommand).callsFake((input) => table.update(input));
  documentClientMock.on(QueryCommand).callsFake((input) => table.query(input));
  documentClientMock.on(TransactWriteCommand).callsFake((input) => table.transactWrite(input));
  documentClientMock.on(BatchWriteCommand).callsFake((input) => table.batchWrite(input));
});

async function withUow<T>(fn: () => Promise<T>, options: UnitOfWorkOptionsInput = { isTransactional: true }): Promise<T> {
  const uow = provider.getRequired(IUnitOfWorkManager).begin(options, true);
  try {
    const result = await fn();
    await uow.complete();
    return result;
  } finally {
    await uow.dispose();
  }
}

function bookRepository(): IBookRepository {
  return provider.getRequired(IBookRepository);
}

describe("addDynamoDbContext", () => {
  it("registers default repositories for aggregate roots, specified entities and custom repositories", () => {
    expect(provider.getRequired(repositoryToken(Book))).toBeInstanceOf(BookRepository);
    expect(provider.getRequired(IBookRepository)).toBeInstanceOf(BookRepository);
    expect(provider.getRequired(repositoryToken(Category)).constructor.name).toBe("DynamoDbRepository<BookStoreDbContext, Category>");
    expect(provider.getRequired(repositoryToken(Tag))).toBeInstanceOf(DynamoDbRepository);
    expect(() => provider.getRequired(repositoryToken(Review))).toThrow(/IRepository<Review>/);
    expect(dynamoDbRepositoryClassFor(BookStoreDbContext, Category)).toBe(dynamoDbRepositoryClassFor(BookStoreDbContext, Category));
    expect(provider.getRequired(BookStoreDbContext)).not.toBe(provider.getRequired(BookStoreDbContext));
  });

  it("registers the outbox and inbox of the context under its connection string name", () => {
    expect(provider.getRequired(eventOutboxToken("BookStore"))).toBeInstanceOf(DynamoDbEventOutbox);
    expect(provider.getRequired(eventInboxToken("BookStore"))).toBeInstanceOf(DynamoDbEventInbox);
    const options = provider.getOptions(AbpDistributedEventBusOptions);
    expect(options.outboxes.get("BookStore")?.databaseName).toBe("BookStore");
    expect(options.inboxes.get("BookStore")?.databaseName).toBe("BookStore");
  });

  it("requires a unit of work and resolves the table through the connection strings", async () => {
    const contextProvider = provider.getRequired(dynamoDbContextProviderToken(BookStoreDbContext));
    await expect(contextProvider.getDbContext()).rejects.toThrow(/inside a unit of work/);
    const dbContext = await withUow(() => contextProvider.getDbContext());
    expect(dbContext).toBeInstanceOf(BookStoreDbContext);
    expect(dbContext.tableName).toBe("abp-table");
    expect(dbContext.getEntityConfiguration(Book).multiTenant).toBe(true);
    expect(dbContext.getEntityConfiguration(Book).creationTimeInSortKey).toBe(true);
    expect(dbContext.getEntityConfiguration(Tag).multiTenant).toBe(false);
    expect(() => dbContext.getEntityConfiguration(Review)).toThrow(/Could not find a model/);
  });
});

describe("key layout", () => {
  it("writes host entities without creation time under host#<Entity>#<id> with the id as list sort key", async () => {
    const tags = provider.getRequired(repositoryToken(Tag));
    const tag = await tags.insert(Object.assign(new Tag(), { name: "ddd" }));
    const item = table.itemsOfType("Tag")[0]!;
    expect(item).toMatchObject({ pk: `host#Tag#${tag.id}`, sk: "Tag", gsi1pk: "host#Tag", gsi1sk: tag.id, entityType: "Tag", id: tag.id, name: "ddd" });
    expect(item["gsi2pk"]).toBeUndefined();
  });

  it("writes tenant entities under <tenant>#<Entity>#<id> with creation time, configured indexes and ttl", async () => {
    const currentTenant = provider.getRequired(ICurrentTenant);
    const book = new Book(undefined, "DDD", 40);
    book.isbn = "isbn-1";
    book.expiresAt = new Date("2030-01-01T00:00:00Z");
    const inserted = await currentTenant.run(tenantA, undefined, () => bookRepository().insert(book));
    const item = table.itemsOfType("Book")[0]!;
    expect(item).toMatchObject({
      pk: `${tenantA}#Book#${inserted.id}`,
      sk: "Book",
      gsi1pk: `${tenantA}#Book`,
      gsi1sk: `${inserted.creationTime.toISOString()}#${inserted.id}`,
      gsi2pk: `${tenantA}#Book#isbn-1`,
      gsi2sk: inserted.id,
      entityType: "Book",
      tenantId: tenantA,
      isDeleted: false,
      ttl: Math.ceil(new Date("2030-01-01T00:00:00Z").getTime() / 1000),
    });
    expect(item["creatorId"]).toBeNull();
    expect(item["__types"]).toMatchObject({ creationTime: "date", expiresAt: "date", extraProperties: "extraProperties", tags: "set" });
  });
});

describe("unit of work", () => {
  it("buffers writes of a transactional unit of work and flushes them as one TransactWriteItems with conditions", async () => {
    const repository = bookRepository();
    const existing = await repository.insert(new Book(undefined, "Existing", 1));
    documentClientMock.resetHistory();

    await withUow(async () => {
      const created = await repository.insert(new Book(undefined, "New", 2));
      created.price = 3;
      await repository.update(created);
      const loaded = await repository.get(existing.id);
      loaded.price = 5;
      await repository.update(loaded);
      expect(documentClientMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
      expect(documentClientMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    const calls = documentClientMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    const items = calls[0]!.args[0].input.TransactItems!;
    expect(items).toHaveLength(2);
    expect(items[0]!.Put).toMatchObject({ TableName: "abp-table", ConditionExpression: "attribute_not_exists(#pk)" });
    expect(items[0]!.Put!.Item).toMatchObject({ title: "New", price: 3 });
    expect(items[1]!.Put).toMatchObject({ ConditionExpression: "attribute_exists(#pk) AND #concurrencyStamp = :concurrencyStamp", ExpressionAttributeValues: { ":concurrencyStamp": existing.concurrencyStamp } });
    expect((await repository.get(existing.id)).price).toBe(5);
  });

  it("sends nothing when the unit of work is disposed without completing", async () => {
    const repository = bookRepository();
    const uow = provider.getRequired(IUnitOfWorkManager).begin({ isTransactional: true }, true);
    const book = await repository.insert(new Book(undefined, "Uncommitted"));
    expect(await repository.find(book.id)).toBeDefined();
    await uow.dispose();

    expect(documentClientMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(documentClientMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(table.items.size).toBe(0);
    expect(await repository.find(book.id)).toBeUndefined();
  });

  it("flushes non-transactional units of work with conditional single writes and batches the rest", async () => {
    const repository = bookRepository();
    const book = await withUow(() => repository.insert(new Book(undefined, "Plain")), { isTransactional: false });
    expect(documentClientMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(documentClientMock.commandCalls(PutCommand)[0]!.args[0].input.ConditionExpression).toBe("attribute_not_exists(#pk)");

    await withUow(() => repository.deleteDirect((b) => b.id === book.id), { isTransactional: false });
    const batches = documentClientMock.commandCalls(BatchWriteCommand);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.args[0].input.RequestItems!["abp-table"]![0]!.DeleteRequest!.Key).toEqual({ pk: `host#Book#${book.id}`, sk: "Book" });
    expect(table.items.size).toBe(0);
  });

  it("falls back to batched writes above 100 items, or fails with strictTransactions", async () => {
    const tags = provider.getRequired(repositoryToken(Tag));
    await withUow(() => tags.insertMany(Array.from({ length: 101 }, (_, i) => Object.assign(new Tag(), { name: `t${i}` }))));
    expect(documentClientMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(documentClientMock.commandCalls(PutCommand)).toHaveLength(101);
    expect(table.itemsOfType("Tag")).toHaveLength(101);

    const options = provider.getOptions(AbpDynamoDbOptions);
    options.strictTransactions = true;
    try {
      await expect(withUow(() => tags.insertMany(Array.from({ length: 101 }, () => new Tag())))).rejects.toThrow(/at most 100 items/);
    } finally {
      options.strictTransactions = false;
    }
  });
});

describe("DynamoDbRepository", () => {
  it("round-trips dates, extra properties, sets and the class prototype", async () => {
    const repository = bookRepository();
    const book = new Book(undefined, "DDD", 40);
    book.publishedAt = new Date("2003-08-30T00:00:00Z");
    book.tags.add("design");
    book.extraProperties.set("edition", 1);
    const inserted = await repository.insert(book);
    expect(Guid.isValid(inserted.id)).toBe(true);

    const loaded = await repository.get(inserted.id);
    expect(loaded).not.toBe(inserted);
    expect(loaded).toBeInstanceOf(Book);
    expect(loaded).toMatchObject({ id: inserted.id, title: "DDD", price: 40, isDeleted: false });
    expect(loaded.creationTime).toBeInstanceOf(Date);
    expect(loaded.publishedAt).toEqual(new Date("2003-08-30T00:00:00Z"));
    expect(loaded.tags).toEqual(new Set(["design"]));
    expect(loaded.extraProperties).toBeInstanceOf(ExtraPropertyDictionary);
    expect(loaded.extraProperties.get("edition")).toBe(1);
    expect("creatorId" in loaded && loaded.creatorId === undefined).toBe(true);
    expect(loaded.entityEquals(inserted)).toBe(true);

    loaded.price = 35;
    await repository.update(loaded);
    const reloaded = await repository.get(inserted.id);
    expect(reloaded.price).toBe(35);
    expect(reloaded.lastModificationTime).toBeInstanceOf(Date);
    expect(reloaded.concurrencyStamp).not.toBe(inserted.concurrencyStamp);
    await expect(repository.get("0192b7b4-4c8f-7a3e-9a2c-2f3f0a5f1a10")).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it("reads its own uncommitted writes inside a unit of work", async () => {
    const repository = bookRepository();
    await withUow(async () => {
      const book = await repository.insert(new Book(undefined, "Pending"));
      expect((await repository.get(book.id)).title).toBe("Pending");
      await repository.delete(book);
      expect(await repository.find(book.id)).toBeUndefined();
      expect((await provider.getRequired(IDataFilter).runDisabled(SoftDeleteFilter, () => repository.get(book.id))).isDeleted).toBe(true);
    });
    const items = documentClientMock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(items).toHaveLength(1);
    expect(items[0]!.Put).toMatchObject({ ConditionExpression: "attribute_not_exists(#pk)" });
    expect(table.itemsOfType("Book")[0]).toMatchObject({ title: "Pending", isDeleted: true });

    const tags = provider.getRequired(repositoryToken(Tag));
    await withUow(async () => {
      const tag = await tags.insert(Object.assign(new Tag(), { name: "gone" }));
      await tags.delete(tag);
    });
    expect(table.itemsOfType("Tag")).toHaveLength(0);
    expect(documentClientMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });

  it("soft-deletes, filters deleted entities on reads and hard-deletes on request", async () => {
    const repository = bookRepository();
    const dataFilter = provider.getRequired(IDataFilter);
    const book = await repository.insert(new Book(undefined, "Soft"));

    await repository.delete(book);
    expect(book.isDeleted).toBe(true);
    expect(book.deletionTime).toBeInstanceOf(Date);
    expect(table.itemsOfType("Book")[0]).toMatchObject({ isDeleted: true, id: book.id });
    expect(documentClientMock.commandCalls(DeleteCommand)).toHaveLength(0);

    expect(await repository.find(book.id)).toBeUndefined();
    expect(await repository.getCount()).toBe(0);
    expect((await dataFilter.runDisabled(SoftDeleteFilter, () => repository.get(book.id))).isDeleted).toBe(true);
    expect(await dataFilter.runDisabled(SoftDeleteFilter, () => repository.getCount())).toBe(1);

    await hardDelete(repository, (b) => b.title === "Soft");
    expect(table.itemsOfType("Book")).toHaveLength(0);
  });

  it("isolates tenants by key space", async () => {
    const repository = bookRepository();
    const currentTenant = provider.getRequired(ICurrentTenant);
    const dataFilter = provider.getRequired(IDataFilter);

    const tenantBook = await currentTenant.run(tenantA, undefined, () => repository.insert(new Book(undefined, "Tenant")));
    const hostBook = await repository.insert(new Book(undefined, "Host"));
    expect(tenantBook.tenantId).toBe(tenantA);
    expect(hostBook.tenantId).toBeUndefined();

    expect((await repository.getList()).map((b) => b.title)).toEqual(["Host"]);
    expect((await currentTenant.run(tenantA, undefined, () => repository.getList())).map((b) => b.title)).toEqual(["Tenant"]);
    expect(await currentTenant.run(tenantA, undefined, () => repository.find(hostBook.id))).toBeUndefined();
    expect(await repository.find(tenantBook.id)).toBeUndefined();
    expect((await currentTenant.run(tenantA, undefined, () => repository.get(tenantBook.id))).title).toBe("Tenant");
    expect(await currentTenant.run(tenantA, undefined, () => dataFilter.runDisabled(MultiTenantFilter, () => repository.getCount()))).toBe(1);
  });

  it("pages and sorts natively on gsi1, in memory for other orderings, and counts with Select COUNT", async () => {
    const repository = bookRepository();
    const books = [new Book(undefined, "C", 3), new Book(undefined, "A", 1), new Book(undefined, "B", 2)];
    books.forEach((book, i) => (book.creationTime = new Date(Date.UTC(2026, 0, i + 1))));
    await repository.insertMany(books);
    documentClientMock.resetHistory();

    expect((await repository.getPagedList(0, 2, "creationTime desc")).map((b) => b.title)).toEqual(["B", "A"]);
    const nativeQuery = documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(nativeQuery).toMatchObject({ IndexName: "gsi1", ScanIndexForward: false, Limit: 2, ExpressionAttributeValues: { ":pk": "host#Book", ":notDeleted": false } });
    expect(nativeQuery.FilterExpression).toBe("attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted");

    expect((await repository.getPagedList(1, 5, "price")).map((b) => b.title)).toEqual(["B", "C"]);
    expect((await repository.getList()).map((b) => b.title)).toEqual(["C", "A", "B"]);
    expect(await repository.count((b) => b.price >= 2)).toBe(2);
    expect(await repository.any((b) => b.title === "Z")).toBe(false);
    expect((await repository.firstOrDefault((b) => b.price > 1))?.title).toBe("C");

    documentClientMock.resetHistory();
    expect(await repository.getCount()).toBe(3);
    expect(documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input.Select).toBe("COUNT");
  });

  it("queries a configured index with usingIndex", async () => {
    const repository = bookRepository();
    const book = new Book(undefined, "Indexed");
    book.isbn = "isbn-42";
    await repository.insert(book);
    documentClientMock.resetHistory();

    expect((await repository.findByIsbn("isbn-42"))?.id).toBe(book.id);
    expect(await repository.findByIsbn("isbn-0")).toBeUndefined();
    const query = documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(query).toMatchObject({ IndexName: "gsi2", KeyConditionExpression: "#pk = :pk", ExpressionAttributeNames: { "#pk": "gsi2pk" }, ExpressionAttributeValues: { ":pk": "host#Book#isbn-42" }, Limit: 1 });
    await expect((await repository.getQueryable()).where(() => true).toList()).resolves.toHaveLength(1);
  });

  it("throws AbpDbConcurrencyException when the concurrency stamp changed (transactional and single writes)", async () => {
    const repository = bookRepository();
    const book = await repository.insert(new Book(undefined, "Stamp"));
    const copy = await repository.get(book.id);
    copy.concurrencyStamp = "changed";
    await expect(repository.update(copy)).rejects.toBeInstanceOf(AbpDbConcurrencyException);
    await expect(withUow(() => repository.update(copy), { isTransactional: false })).rejects.toBeInstanceOf(AbpDbConcurrencyException);
    await repository.update(book);
    await expect(repository.insert(new Book(book.id, "dup"))).rejects.toBeInstanceOf(AbpDbConcurrencyException);
  });

  it("publishes entity change events when the unit of work completes and drops them on rollback", async () => {
    const repository = bookRepository();
    const localBus = provider.getRequired(ILocalEventBus);
    const created: string[] = [];
    using _ = localBus.subscribe(EntityCreatedEventData.of(Book), (e) => void created.push(e.entity.title));

    const uow = provider.getRequired(IUnitOfWorkManager).begin({ isTransactional: true }, true);
    await repository.insert(new Book(undefined, "Dropped"));
    await uow.dispose();
    expect(created).toEqual([]);

    await withUow(async () => {
      await repository.insert(new Book(undefined, "Committed"));
      expect(created).toEqual([]);
    });
    expect(created).toEqual(["Committed"]);
  });

  it("records entity history for selected entities inside an audit scope", async () => {
    const repository = bookRepository();
    const auditingManager = provider.getRequired(IAuditingManager);
    const book = await repository.insert(new Book(undefined, "History", 10));

    await auditingManager.runInScope(async (scope) => {
      const loaded = await repository.get(book.id);
      loaded.price = 20;
      await repository.update(loaded);
      const change = scope.log.entityChanges.find((c) => c.entityTypeFullName === "Book");
      expect(change?.entityId).toBe(book.id);
      expect(change?.propertyChanges.map((p) => p.propertyName)).toContain("price");
      expect(change?.propertyChanges.find((p) => p.propertyName === "price")).toMatchObject({ originalValue: "10", newValue: "20" });
    });
  });
});

describe("event boxes", () => {
  it("outbox: enqueues, lists waiting events in creation order and deletes them", async () => {
    const outbox = provider.getRequired(eventOutboxToken("BookStore"));
    const later = new OutgoingEventInfo(Guid.newGuid(), "Book.Created", '{"id":2}', new Date("2026-01-02T00:00:00Z"));
    const earlier = new OutgoingEventInfo(Guid.newGuid(), "Book.Created", '{"id":1}', new Date("2026-01-01T00:00:00Z"));
    earlier.setCorrelationId("corr-1");
    await outbox.enqueue(later);
    await outbox.enqueue(earlier);
    expect(table.itemsOfType("OutgoingEventRecord")[0]).toMatchObject({ sk: "outbox", gsi1pk: "outbox#BookStore" });

    const waiting = await outbox.getWaitingEvents(10);
    expect(waiting.map((e) => e.id)).toEqual([earlier.id, later.id]);
    expect(waiting[0]).toBeInstanceOf(OutgoingEventInfo);
    expect(waiting[0]!.getCorrelationId()).toBe("corr-1");
    expect(waiting[0]!.creationTime).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(await outbox.getWaitingEvents(1, (e) => e.eventData.includes("2"))).toHaveLength(1);

    await outbox.delete(earlier.id);
    await outbox.deleteMany([later.id]);
    expect(await outbox.getWaitingEvents(10)).toEqual([]);
    expect(table.items.size).toBe(0);
  });

  it("inbox: enqueues, detects duplicate messages, lists pending events and updates their status", async () => {
    const inbox = provider.getRequired(eventInboxToken("BookStore"));
    const pending = new IncomingEventInfo(Guid.newGuid(), "msg-1", "Book.Created", "{}", new Date("2026-01-01T00:00:00Z"));
    const retrying = new IncomingEventInfo(Guid.newGuid(), "msg-2", "Book.Created", "{}", new Date("2026-01-01T00:00:01Z"), IncomingEventStatus.Pending, undefined, 1, new Date("2999-01-01T00:00:00Z"));
    await inbox.enqueue(pending);
    await inbox.enqueue(retrying);

    expect(await inbox.existsByMessageId("msg-1")).toBe(true);
    expect(await inbox.existsByMessageId("msg-9")).toBe(false);
    expect((await inbox.getWaitingEvents(10)).map((e) => e.id)).toEqual([pending.id]);

    await inbox.markAsProcessed(pending.id);
    await inbox.retryLater(retrying.id, 2, undefined);
    const waiting = await inbox.getWaitingEvents(10);
    expect(waiting.map((e) => e.id)).toEqual([retrying.id]);
    expect(waiting[0]!.retryCount).toBe(2);

    await inbox.markAsDiscard(retrying.id);
    expect(await inbox.getWaitingEvents(10)).toEqual([]);
    expect(table.itemsOfType("IncomingEventRecord").map((i) => i["status"])).toEqual([IncomingEventStatus.Processed, IncomingEventStatus.Discarded]);
    await inbox.deleteOldEvents();
    expect(table.itemsOfType("IncomingEventRecord")).toHaveLength(0);
  });
});

describe("DefaultDynamoDbEntitySerializer", () => {
  it("stores undefined as null, revives typed values by path and restores the prototype", () => {
    const serializer = new DefaultDynamoDbEntitySerializer();
    const book = new Book("id-1", "Ser", 1);
    book.publishedAt = new Date("2020-02-02T00:00:00Z");
    const item = serializer.serialize({ ...book, meta: new Map([["when", new Date("2021-01-01T00:00:00Z")]]), big: 10n, nested: { at: new Date("2022-01-01T00:00:00Z") } });
    expect(item["creatorId"]).toBeNull();
    expect(item["publishedAt"]).toBe("2020-02-02T00:00:00.000Z");
    expect(item["__types"]).toMatchObject({ publishedAt: "date", "meta.0.1": "date", meta: "map", big: "bigint", "nested.at": "date" });

    const revived = serializer.deserialize(item, Book) as Book & { meta: Map<string, Date>; big: bigint; nested: { at: Date } };
    expect(revived).toBeInstanceOf(Book);
    expect(revived.creatorId).toBeUndefined();
    expect("creatorId" in revived).toBe(true);
    expect(revived.publishedAt).toEqual(new Date("2020-02-02T00:00:00Z"));
    expect(revived.meta.get("when")).toEqual(new Date("2021-01-01T00:00:00Z"));
    expect(revived.big).toBe(10n);
    expect(revived.nested.at).toEqual(new Date("2022-01-01T00:00:00Z"));
    expect(revived.extraProperties).toBeInstanceOf(ExtraPropertyDictionary);
  });
});

describe("DynamoDbTableManager", () => {
  it("creates the single table with the CDK schema when it is missing", async () => {
    dynamoDbClientMock.on(DescribeTableCommand).rejectsOnce(Object.assign(new Error("not found"), { name: "ResourceNotFoundException" })).resolves({ Table: { TableStatus: "ACTIVE" } });
    dynamoDbClientMock.on(CreateTableCommand).resolves({});
    dynamoDbClientMock.on(UpdateTimeToLiveCommand).resolves({});

    const manager = provider.getRequired(IDynamoDbTableManager);
    expect(await manager.ensureTableExists()).toBe(true);
    const created = dynamoDbClientMock.commandCalls(CreateTableCommand)[0]!.args[0].input;
    expect(created.TableName).toBe("abp-table");
    expect(created.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(created.GlobalSecondaryIndexes!.map((i) => i.IndexName)).toEqual(["gsi1", "gsi2", "gsi3"]);
    expect(dynamoDbClientMock.commandCalls(UpdateTimeToLiveCommand)[0]!.args[0].input.TimeToLiveSpecification).toEqual({ AttributeName: "ttl", Enabled: true });

    expect(await manager.ensureTableExists("abp-table")).toBe(false);
    await expect(manager.ensureTableExists("")).rejects.toBeInstanceOf(AbpException);
  });
});
