import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Guid, NullLoggerFactory, Transient, createToken, type IServiceProvider } from "@abp/core";
import { AbpDbConcurrencyException, ConnectionStringName, IDataFilter, MultiTenantFilter, SoftDeleteFilter } from "@abp/data";
import { AggregateRoot, Entity, EntityCreatedEventData, EntityNotFoundException, FullAuditedAggregateRoot, hardDelete, repositoryToken, type IRepository } from "@abp/ddd-domain";
import { ILocalEventBus } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import { AbpMemoryDbModule, MemoryDatabaseManager, MemoryDbContext, MemoryDbRepository, addMemoryDbContext, deepClone, memoryDatabaseProviderToken, memoryDbRepositoryClassFor, type IMemoryDatabaseProvider } from "../src/index.js";

class Book extends FullAuditedAggregateRoot<string> {
  title = "";
  price = 0;
  tenantId: string | undefined = undefined;
  publishedAt: Date | undefined = undefined;
  constructor(id?: string, title = "", price = 0) {
    super(id);
    this.title = title;
    this.price = price;
  }
}

class Tag extends Entity<number> {
  override id = 0;
  name = "";
}

class Review extends Entity<string> {
  text = "";
}

class Category extends AggregateRoot<string> {
  name = "";
}

@ConnectionStringName("BookStore")
class BookStoreDbContext extends MemoryDbContext {
  override readonly entities = [Book, Tag, Review, Category];
}

interface IBookRepository extends IRepository<Book, string> {
  findByTitle(title: string): Promise<Book | undefined>;
}
const IBookRepository = createToken<IBookRepository>("IBookRepository");

@Transient(IBookRepository)
class BookRepository extends MemoryDbRepository<BookStoreDbContext, Book, string> implements IBookRepository {
  static readonly inject = [memoryDatabaseProviderToken(BookStoreDbContext)] as const;
  constructor(databaseProvider: IMemoryDatabaseProvider<BookStoreDbContext>) {
    super(databaseProvider, Book);
  }
  async findByTitle(title: string): Promise<Book | undefined> {
    return (await this.getQueryable()).where((b) => b.title === title).firstOrDefault();
  }
}

@DependsOn(AbpMemoryDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    addMemoryDbContext(this.context.services, BookStoreDbContext, (options) => {
      options.addDefaultRepositories().addRepository(Book, BookRepository).addDefaultRepository(Tag);
    });
  }
}

const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
let app: AbpApplication;
let provider: IServiceProvider;

beforeAll(async () => {
  app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { ConnectionStrings: { Default: "memory://default" } } }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  provider = app.serviceProvider;
});
afterAll(() => app.shutdown());

async function withUow<T>(fn: () => Promise<T>): Promise<T> {
  const uow = provider.getRequired(IUnitOfWorkManager).begin(undefined, true);
  try {
    const result = await fn();
    await uow.complete();
    return result;
  } finally {
    await uow.dispose();
  }
}

describe("addMemoryDbContext", () => {
  it("registers default repositories for aggregate roots, specified entities and custom repositories", () => {
    expect(provider.getRequired(repositoryToken(Book))).toBeInstanceOf(BookRepository);
    expect(provider.getRequired(IBookRepository)).toBeInstanceOf(BookRepository);
    expect(provider.getRequired(repositoryToken(Category)).constructor.name).toBe("MemoryDbRepository<BookStoreDbContext, Category>");
    expect(provider.getRequired(repositoryToken(Tag))).toBeInstanceOf(MemoryDbRepository);
    expect(() => provider.getRequired(repositoryToken(Review))).toThrow(/IRepository<Review>/);
    expect(memoryDbRepositoryClassFor(BookStoreDbContext, Category)).toBe(memoryDbRepositoryClassFor(BookStoreDbContext, Category));
    expect(provider.getRequired(BookStoreDbContext)).toBe(provider.getRequired(BookStoreDbContext));
  });

  it("requires a unit of work to open the database and keeps one database per connection string", async () => {
    const databaseProvider = provider.getRequired(memoryDatabaseProviderToken(BookStoreDbContext));
    await expect(databaseProvider.getDatabase()).rejects.toThrow(/inside a unit of work/);
    expect(await databaseProvider.getDbContext()).toBeInstanceOf(BookStoreDbContext);
    const first = await withUow(() => databaseProvider.getDatabase());
    const second = await withUow(() => databaseProvider.getDatabase());
    expect(first).toBe(second);
    const manager = provider.getRequired(MemoryDatabaseManager);
    expect(manager.get("memory://default")).toBe(first);
    expect(manager.get("other")).not.toBe(first);
  });
});

describe("MemoryDbRepository", () => {
  it("inserts, reads copies, updates and deletes", async () => {
    const repository = provider.getRequired(IBookRepository);
    const localBus = provider.getRequired(ILocalEventBus);
    const created: string[] = [];
    using _ = localBus.subscribe(EntityCreatedEventData.of(Book), (e) => void created.push(e.entity.title));

    const book = await repository.insert(new Book(undefined, "DDD", 40));
    expect(Guid.isValid(book.id)).toBe(true);
    expect(book.creationTime).toBeInstanceOf(Date);
    expect(created).toEqual(["DDD"]);

    const loaded = await repository.get(book.id);
    expect(loaded).not.toBe(book);
    expect(loaded).toBeInstanceOf(Book);
    expect(loaded).toMatchObject({ id: book.id, title: "DDD", price: 40, isDeleted: false });
    expect(loaded.creationTime).toBeInstanceOf(Date);
    expect(loaded.extraProperties).toBeInstanceOf(Map);
    expect(await repository.findByTitle("DDD")).toMatchObject({ id: book.id });

    loaded.price = 35;
    await repository.update(loaded);
    expect((await repository.get(book.id)).price).toBe(35);
    expect((await repository.get(book.id)).lastModificationTime).toBeInstanceOf(Date);

    await expect(repository.get("0192b7b4-4c8f-7a3e-9a2c-2f3f0a5f1a10")).rejects.toBeInstanceOf(EntityNotFoundException);
    await repository.deleteById(book.id);
    expect(await repository.find(book.id)).toBeUndefined();
    await repository.deleteById(book.id);
  });

  it("does not let stale copies overwrite newer ones (concurrency stamp)", async () => {
    const repository = provider.getRequired(IBookRepository);
    const book = await repository.insert(new Book(undefined, "Stamp"));
    const copy = await repository.get(book.id);
    copy.concurrencyStamp = "changed";
    await expect(repository.update(copy)).rejects.toBeInstanceOf(AbpDbConcurrencyException);
    await repository.update(book);
    await expect(repository.insert(new Book(book.id, "dup"))).rejects.toThrow(/already exists/);
  });

  it("generates sequential numeric ids per entity type", async () => {
    const tags = provider.getRequired(repositoryToken(Tag));
    const a = await tags.insert(Object.assign(new Tag(), { name: "a" }));
    const b = await tags.insert(Object.assign(new Tag(), { name: "b" }));
    expect([a.id, b.id]).toEqual([1, 2]);
    expect((await tags.get(2)).name).toBe("b");
    const manual = Object.assign(new Tag(), { name: "manual" });
    manual.id = 42;
    await tags.insert(manual);
    expect((await tags.get(42)).name).toBe("manual");
  });

  it("pages, sorts, counts and filters through the query builder", async () => {
    const repository = provider.getRequired(IBookRepository);
    await repository.deleteMany(() => true);
    await repository.insertMany([new Book(undefined, "C", 3), new Book(undefined, "A", 1), new Book(undefined, "B", 2)]);

    expect((await repository.getPagedList(0, 2, "title")).map((b) => b.title)).toEqual(["A", "B"]);
    expect((await repository.getPagedList(1, 5, "price desc")).map((b) => b.title)).toEqual(["B", "A"]);
    expect(await repository.getCount()).toBe(3);
    expect(await repository.count((b) => b.price >= 2)).toBe(2);
    expect(await repository.any((b) => b.title === "Z")).toBe(false);
    expect((await (await repository.query()).orderBy("price", "desc").take(1).toList())[0]!.title).toBe("C");
    expect((await repository.getList((b) => b.price < 3)).length).toBe(2);
    expect((await repository.firstOrDefault((b) => b.price > 1))?.title).toBe("C");
  });

  it("soft-deletes full audited entities and honours the soft-delete filter and hard delete", async () => {
    const repository = provider.getRequired(IBookRepository);
    const dataFilter = provider.getRequired(IDataFilter);
    await repository.deleteMany(() => true);
    const book = await repository.insert(new Book(undefined, "Soft"));

    await repository.delete(book);
    expect(book.isDeleted).toBe(true);
    expect(book.deletionTime).toBeInstanceOf(Date);
    expect(await repository.getCount()).toBe(0);
    expect(await dataFilter.runDisabled(SoftDeleteFilter, () => repository.count((b) => b.id === book.id))).toBe(1);
    expect((await dataFilter.runDisabled(SoftDeleteFilter, () => repository.get(book.id))).isDeleted).toBe(true);

    await hardDelete(repository, (b) => b.title === "Soft");
    expect(await dataFilter.runDisabled(SoftDeleteFilter, () => repository.count((b) => b.id === book.id))).toBe(0);

    const direct = await repository.insert(new Book(undefined, "Direct"));
    await repository.deleteDirect((b) => b.id === direct.id);
    expect(await repository.count((b) => b.id === direct.id)).toBe(0);
    expect((await dataFilter.runDisabled(SoftDeleteFilter, () => repository.get(direct.id))).isDeleted).toBe(true);
  });

  it("scopes multi-tenant entities to the current tenant", async () => {
    const repository = provider.getRequired(IBookRepository);
    const currentTenant = provider.getRequired(ICurrentTenant);
    const dataFilter = provider.getRequired(IDataFilter);
    await dataFilter.runDisabled(MultiTenantFilter, () => repository.deleteMany(() => true));

    const tenantBook = await currentTenant.run(tenantA, undefined, () => repository.insert(new Book(undefined, "Tenant")));
    const hostBook = await repository.insert(new Book(undefined, "Host"));
    expect(tenantBook.tenantId).toBe(tenantA);
    expect(hostBook.tenantId).toBeUndefined();

    expect((await repository.getList()).map((b) => b.title)).toEqual(["Host"]);
    expect((await currentTenant.run(tenantA, undefined, () => repository.getList())).map((b) => b.title)).toEqual(["Tenant"]);
    expect(await currentTenant.run(tenantA, undefined, () => repository.find(hostBook.id))).toBeUndefined();
    expect(await dataFilter.runDisabled(MultiTenantFilter, () => repository.getCount())).toBe(2);
  });

  it("writes immediately: an incomplete unit of work keeps its inserts but drops its events", async () => {
    const repository = provider.getRequired(IBookRepository);
    const localBus = provider.getRequired(ILocalEventBus);
    const created: string[] = [];
    using _ = localBus.subscribe(EntityCreatedEventData.of(Book), (e) => void created.push(e.entity.title));

    const uow = provider.getRequired(IUnitOfWorkManager).begin(undefined, true);
    const book = await repository.insert(new Book(undefined, "Uncommitted"));
    expect(await repository.find(book.id)).toBeDefined();
    await uow.dispose();

    expect(await repository.find(book.id)).toBeDefined();
    expect(created).toEqual([]);

    await withUow(async () => {
      await repository.insert(new Book(undefined, "Committed"));
      expect(created).toEqual([]);
    });
    expect(created).toEqual(["Committed"]);
  });
});

describe("deepClone", () => {
  it("preserves prototypes, dates, maps, sets and cycles", () => {
    class Node {
      next: Node | undefined = undefined;
      tags = new Set(["x"]);
      meta = new Map([["k", new Date("2024-01-01")]]);
    }
    const node = new Node();
    node.next = node;
    const clone = deepClone(node);
    expect(clone).toBeInstanceOf(Node);
    expect(clone).not.toBe(node);
    expect(clone.next).toBe(clone);
    expect(clone.tags).toEqual(new Set(["x"]));
    expect(clone.meta.get("k")).toEqual(new Date("2024-01-01"));
    expect(clone.meta.get("k")).not.toBe(node.meta.get("k"));
  });
});
