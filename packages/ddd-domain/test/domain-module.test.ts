import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Guid, NullLoggerFactory, Transient, type AbstractClass, type IServiceProvider } from "@abp/core";
import { IDataFilter, MultiTenantFilter, SoftDeleteFilter } from "@abp/data";
import { IDistributedEventBus, ILocalEventBus } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpObjectMappingOptions, MappingProfile } from "@abp/object-mapping";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor } from "@abp/security";
import { IUnitOfWorkManager } from "@abp/uow";
import {
  AbpDddDomainModule,
  AbpDistributedEntityEventOptions,
  AggregateRoot,
  ArrayQueryable,
  DisableEntityChangeTracking,
  EnableEntityChangeTracking,
  Entity,
  EntityCreatedEto,
  EntityCreatedEventData,
  EntityDeletedEventData,
  EntityEto,
  EntityNotFoundException,
  EntityUpdatedEventData,
  FullAuditedAggregateRoot,
  IEntityChangeEventHelper,
  IEntityChangeTrackingProvider,
  RepositoryBase,
  addDefaultRepositoryProvider,
  basicRepositoryToken,
  disableTracking,
  entityTypeOfRepositoryToken,
  hardDelete,
  readOnlyRepositoryToken,
  registerDefaultRepository,
  repositoryToken,
  type EntityPredicate,
  type IQueryable,
  type IRepository,
} from "../src/index.js";

class Book extends FullAuditedAggregateRoot<string> {
  title = "";
  tenantId: string | undefined = undefined;
  constructor(id?: string, title = "") {
    super(id);
    this.title = title;
  }
}

class Product extends AggregateRoot<string> {
  name = "";
}
class ProductEto {
  id = "";
  name = "";
}
class ProductProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(Product, ProductEto, (p) => {
      const eto = new ProductEto();
      eto.id = p.id;
      eto.name = p.name;
      return eto;
    });
  }
}

class Orphan extends Entity<string> {}

const stores = new Map<unknown, object[]>();
function storeOf<T extends object>(type: unknown): T[] {
  let store = stores.get(type);
  if (!store) {
    store = [];
    stores.set(type, store);
  }
  return store as T[];
}

/** A minimal array-backed repository exercising RepositoryBase's shared behaviour. */
class InMemoryRepository<TEntity extends Entity<string>> extends RepositoryBase<TEntity, string> {
  constructor(entityType: AbstractClass<TEntity>) {
    super("Test", entityType);
  }
  get store(): TEntity[] {
    return storeOf<TEntity>(this.entityType);
  }
  async getQueryable(): Promise<IQueryable<TEntity>> {
    return this.applyDataFilters(ArrayQueryable.from(this.store));
  }
  async insert(entity: TEntity): Promise<TEntity> {
    this.applyAbpConceptsForAddedEntity(entity);
    this.store.push(entity);
    return entity;
  }
  async update(entity: TEntity): Promise<TEntity> {
    this.applyAbpConceptsForUpdatedEntity(entity);
    return entity;
  }
  async delete(entity: TEntity): Promise<void> {
    this.applyAbpConceptsForDeletedEntity(entity);
    if (this.shouldHardDelete(entity)) {
      const index = this.store.indexOf(entity);
      if (index >= 0) this.store.splice(index, 1);
      return;
    }
    (entity as unknown as { isDeleted: boolean }).isDeleted = true;
  }
  async deleteDirect(predicate: EntityPredicate<TEntity>): Promise<void> {
    const matches = await ArrayQueryable.from(this.store).where(predicate).toList();
    for (const m of matches) this.store.splice(this.store.indexOf(m), 1);
  }
}

class BookRepository extends InMemoryRepository<Book> {
  static readonly inject = [] as const;
  constructor() {
    super(Book);
  }
}

@Transient()
class BookManager {
  static readonly inject = [IEntityChangeTrackingProvider, repositoryToken(Book)] as const;
  constructor(
    readonly tracking: IEntityChangeTrackingProvider,
    readonly repository: IRepository<Book, string>,
  ) {}

  @DisableEntityChangeTracking()
  async readOnlyWork(): Promise<[boolean | undefined, boolean]> {
    return [this.tracking.enabled, (this.repository as unknown as BookRepository).shouldTrackingEntityChange()];
  }

  @EnableEntityChangeTracking()
  async trackedWork(): Promise<boolean | undefined> {
    return this.tracking.enabled;
  }

  async plainWork(): Promise<boolean | undefined> {
    return this.tracking.enabled;
  }
}

@DependsOn(AbpDddDomainModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    registerDefaultRepository(this.context.services, Book, BookRepository);
    addDefaultRepositoryProvider(this.context.services, (entityType) => (entityType === Product ? () => new InMemoryRepository(Product) : undefined));
    this.configure(AbpDistributedEntityEventOptions, (options) => {
      options.autoEventSelectors.addAll();
      options.etoMappings.add(Product, ProductEto);
    });
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(ProductProfile);
    });
  }
}

const userId: string = "0b7c9d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

let app: AbpApplication;
let provider: IServiceProvider;

beforeAll(async () => {
  app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  provider = app.serviceProvider;
});
afterAll(() => app.shutdown());

async function inUow<T>(fn: () => Promise<T>): Promise<T> {
  const manager = provider.getRequired(IUnitOfWorkManager);
  const uow = manager.begin(undefined, true);
  try {
    const result = await fn();
    await uow.complete();
    return result;
  } finally {
    await uow.dispose();
  }
}

describe("repository tokens and registration", () => {
  it("returns a stable token per entity class shared by all repository interfaces", () => {
    expect(repositoryToken(Book)).toBe(repositoryToken(Book));
    expect(basicRepositoryToken(Book)).toBe(repositoryToken(Book));
    expect(readOnlyRepositoryToken(Book)).toBe(repositoryToken(Book));
    expect(repositoryToken(Book)).not.toBe(repositoryToken(Product));
    expect(entityTypeOfRepositoryToken(repositoryToken(Book))).toBe(Book);
    expect(entityTypeOfRepositoryToken(Symbol("x"))).toBeUndefined();
    expect(repositoryToken(Book).description).toBe("IRepository<Book>");
  });

  it("resolves explicitly registered repositories with a lazy service provider", () => {
    const repository = provider.getRequired(repositoryToken(Book));
    expect(repository.providerName).toBe("Test");
    expect(repository.entityType).toBe(Book);
    expect((repository as BookRepository).lazyServiceProvider).toBeDefined();
  });

  it("resolves unregistered entities through the fallback providers of AbpDddDomainModule", () => {
    const repository = provider.getRequired(repositoryToken(Product));
    expect(repository).toBeInstanceOf(InMemoryRepository);
    expect((repository as InMemoryRepository<Product>).lazyServiceProvider).toBeDefined();
    expect(provider.getRequired(repositoryToken(Product))).not.toBe(repository);
    expect(() => provider.getRequired(repositoryToken(Orphan))).toThrow(/IRepository<Orphan>/);
  });
});

describe("RepositoryBase", () => {
  it("applies ABP concepts on insert: tenant, guid id, creation audit, events", async () => {
    const repository = provider.getRequired(repositoryToken(Book));
    const localBus = provider.getRequired(ILocalEventBus);
    const distributedBus = provider.getRequired(IDistributedEventBus);
    const created: Book[] = [];
    const etos: EntityEto[] = [];
    using _local = localBus.subscribe(EntityCreatedEventData.of(Book), (e) => void created.push(e.entity));
    using _distributed = distributedBus.subscribe(EntityCreatedEto.of(EntityEto), (e) => void etos.push(e.entity));

    const principal = provider.getRequired(ICurrentPrincipalAccessor);
    const currentTenant = provider.getRequired(ICurrentTenant);
    const book = new Book(undefined, "Clean Architecture");

    await principal.run(new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.tenantId, tenantA)], "Test")), () =>
      currentTenant.run(tenantA, undefined, () => repository.insert(book)),
    );

    expect(Guid.isValid(book.id)).toBe(true);
    expect(book.tenantId).toBe(tenantA);
    expect(book.creationTime).toBeInstanceOf(Date);
    expect(book.creatorId).toBe(userId);
    expect(created).toEqual([book]);
    expect(etos).toHaveLength(1);
    expect(etos[0]).toMatchObject({ entityType: "Book", keysAsString: book.id, id: book.id, tenantId: tenantA });
  });

  it("publishes one event per entity and event type when a unit of work completes", async () => {
    const repository = provider.getRequired(repositoryToken(Book));
    const localBus = provider.getRequired(ILocalEventBus);
    const received: string[] = [];
    using _c = localBus.subscribe(EntityCreatedEventData.of(Book), (e) => void received.push(`created:${e.entity.title}`));
    using _u = localBus.subscribe(EntityUpdatedEventData.of(Book), (e) => void received.push(`updated:${e.entity.title}`));

    const book = new Book(undefined, "v1");
    await inUow(async () => {
      await repository.insert(book);
      book.title = "v2";
      await repository.update(book);
      book.title = "v3";
      await repository.update(book);
      expect(received).toEqual([]);
    });
    expect(received).toEqual(["created:v3", "updated:v3"]);
    expect(book.lastModificationTime).toBeInstanceOf(Date);
  });

  it("drops the events when the unit of work is not completed", async () => {
    const repository = provider.getRequired(repositoryToken(Book));
    const localBus = provider.getRequired(ILocalEventBus);
    const received: Book[] = [];
    using _c = localBus.subscribe(EntityCreatedEventData.of(Book), (e) => void received.push(e.entity));
    const manager = provider.getRequired(IUnitOfWorkManager);
    const uow = manager.begin(undefined, true);
    await repository.insert(new Book(undefined, "rolled back"));
    await uow.dispose();
    expect(received).toEqual([]);
  });

  it("maps entities to configured ETOs through the object mapper", async () => {
    const repository = provider.getRequired(repositoryToken(Product));
    const distributedBus = provider.getRequired(IDistributedEventBus);
    const received: ProductEto[] = [];
    using _d = distributedBus.subscribe(EntityCreatedEto.of(ProductEto), (e) => void received.push(e.entity));
    const product = new Product();
    product.name = "Keyboard";
    await repository.insert(product);
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(ProductEto);
    expect(received[0]).toMatchObject({ id: product.id, name: "Keyboard" });
  });

  it("warns instead of throwing when there is no unit of work", () => {
    const helper = provider.getRequired(IEntityChangeEventHelper);
    expect(() => helper.publishEntityCreatedEvent(new Book("x"))).not.toThrow();
  });

  it("reads with get/find/count/any/paging and throws EntityNotFoundException", async () => {
    const repository = provider.getRequired(repositoryToken(Book));
    storeOf<Book>(Book).length = 0;
    await repository.insertMany([new Book(undefined, "B"), new Book(undefined, "A"), new Book(undefined, "C")]);

    const a = await repository.get((b) => b.title === "A");
    expect(a.title).toBe("A");
    expect(await repository.get(a.id)).toBe(a);
    expect(await repository.find("0192b7b4-4c8f-7a3e-9a2c-2f3f0a5f1a10")).toBeUndefined();
    await expect(repository.get("0192b7b4-4c8f-7a3e-9a2c-2f3f0a5f1a10")).rejects.toBeInstanceOf(EntityNotFoundException);
    await expect(repository.get((b) => b.title === "Z")).rejects.toThrow(EntityNotFoundException);
    expect(await repository.find((b) => b.title === "Z")).toBeUndefined();
    expect(await repository.getCount()).toBe(3);
    expect(await repository.count((b) => b.title > "A")).toBe(2);
    expect(await repository.any((b) => b.title === "C")).toBe(true);
    expect(await repository.any((b) => b.title === "Q")).toBe(false);
    expect((await repository.getList((b) => b.title !== "B")).map((b) => b.title).sort()).toEqual(["A", "C"]);
    expect((await repository.getPagedList(1, 1, "title desc")).map((b) => b.title)).toEqual(["B"]);
    expect((await repository.getPagedList(0, 10, undefined)).length).toBe(3);
    expect((await repository.firstOrDefault())?.id).toBe([...storeOf<Book>(Book)].sort((x, y) => (x.id < y.id ? -1 : 1))[0]!.id);
  });

  it("soft-deletes and filters soft-deleted entities unless the filter is disabled or hard-deleted", async () => {
    const repository = provider.getRequired(repositoryToken(Book));
    const localBus = provider.getRequired(ILocalEventBus);
    const deleted: Book[] = [];
    using _d = localBus.subscribe(EntityDeletedEventData.of(Book), (e) => void deleted.push(e.entity));
    storeOf<Book>(Book).length = 0;
    const book = await repository.insert(new Book(undefined, "soft"));
    await repository.deleteById(book.id);

    expect(book.isDeleted).toBe(true);
    expect(book.deletionTime).toBeInstanceOf(Date);
    expect(deleted).toEqual([book]);
    expect(storeOf<Book>(Book)).toContain(book);
    expect(await repository.getCount()).toBe(0);

    const dataFilter = provider.getRequired(IDataFilter);
    expect(await dataFilter.runDisabled(SoftDeleteFilter, () => repository.getCount())).toBe(1);

    await hardDelete(repository, (b) => b.title === "soft");
    expect(storeOf<Book>(Book)).not.toContain(book);

    const other = await repository.insert(new Book(undefined, "hard"));
    await hardDelete(repository, other);
    expect(storeOf<Book>(Book)).toEqual([]);
    expect(await repository.getCount()).toBe(0);
  });

  it("filters by the current tenant and lets deleteMany/deleteDirect remove by predicate", async () => {
    const repository = provider.getRequired(repositoryToken(Book));
    const currentTenant = provider.getRequired(ICurrentTenant);
    const dataFilter = provider.getRequired(IDataFilter);
    storeOf<Book>(Book).length = 0;
    await currentTenant.run(tenantA, undefined, () => repository.insert(new Book(undefined, "tenant")));
    await repository.insert(new Book(undefined, "host"));

    expect((await repository.getList()).map((b) => b.title)).toEqual(["host"]);
    expect((await currentTenant.run(tenantA, undefined, () => repository.getList())).map((b) => b.title)).toEqual(["tenant"]);
    expect(await dataFilter.runDisabled(MultiTenantFilter, () => repository.getCount())).toBe(2);

    await repository.deleteMany((b) => b.title === "host");
    expect(await dataFilter.runDisabled([MultiTenantFilter, SoftDeleteFilter], () => repository.getCount())).toBe(2);
    expect(await repository.getCount()).toBe(0);
    await repository.deleteDirect((b) => b.title === "host");
    expect(await dataFilter.runDisabled([MultiTenantFilter, SoftDeleteFilter], () => repository.getCount())).toBe(1);
  });
});

describe("change tracking", () => {
  it("honours method decorators through the interceptor and the repository flag", async () => {
    const manager = provider.getRequired(BookManager);
    expect(await manager.plainWork()).toBeUndefined();
    expect(await manager.readOnlyWork()).toEqual([false, false]);
    expect(await manager.trackedWork()).toBe(true);
    expect(provider.getRequired(IEntityChangeTrackingProvider).enabled).toBeUndefined();

    const repository = provider.getRequired(repositoryToken(Book)) as BookRepository;
    expect(repository.shouldTrackingEntityChange()).toBe(true);
    {
      using _ = disableTracking(repository);
      expect(repository.shouldTrackingEntityChange()).toBe(false);
      expect(await manager.trackedWork()).toBe(true);
    }
    expect(repository.isChangeTrackingEnabled).toBeUndefined();
  });
});
