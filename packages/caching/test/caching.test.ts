import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbpApplication, AbpExceptionHandlingOptions, AbpModule, DependsOn, ExceptionSubscriber, NullLoggerFactory, Transient, type ExceptionNotificationContext } from "@abp/core";
import { ICurrentTenant, IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import {
  AbpCachingModule,
  AbpDistributedCacheOptions,
  CacheName,
  CacheNameAttribute,
  DistributedCacheEntryOptions,
  DistributedCacheKeyNormalizeArgs,
  IDistributedCacheKeyNormalizer,
  IDistributedCacheStore,
  MemoryDistributedCacheStore,
  distributedCacheToken,
  type CacheValue,
  type IDistributedCache,
} from "../src/index.js";

class BookCacheItem {
  constructor(
    public name: string,
    public pages: number,
  ) {}
  get summary(): string {
    return `${this.name} (${this.pages})`;
  }
}

@CacheName("Shared")
@IgnoreMultiTenancy()
class SharedCacheItem {
  constructor(public value: string) {}
}

class BookKey {
  constructor(readonly id: number) {}
  toString(): string {
    return `book-${this.id}`;
  }
}

@Transient()
class BookService {
  static readonly inject = [distributedCacheToken(BookCacheItem), distributedCacheToken<SharedCacheItem>(SharedCacheItem)] as const;
  constructor(
    readonly books: IDistributedCache<BookCacheItem>,
    readonly shared: IDistributedCache<SharedCacheItem>,
  ) {}
}

class RecordingSubscriber extends ExceptionSubscriber {
  static errors: unknown[] = [];
  async handle(context: ExceptionNotificationContext): Promise<void> {
    RecordingSubscriber.errors.push(context.exception);
  }
}

class ThrowingStore extends MemoryDistributedCacheStore {
  fail = false;
  override async get(key: string): Promise<CacheValue | undefined> {
    if (this.fail) throw new Error("store down");
    return super.get(key);
  }
  override async set(key: string, value: CacheValue, options: DistributedCacheEntryOptions): Promise<void> {
    if (this.fail) throw new Error("store down");
    return super.set(key, value, options);
  }
  override async getMany(keys: readonly string[]): Promise<(CacheValue | undefined)[]> {
    if (this.fail) throw new Error("store down");
    return super.getMany(keys);
  }
}

@DependsOn(AbpCachingModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpDistributedCacheOptions, (o) => {
      o.keyPrefix = "app:";
      o.configureCache(BookCacheItem, new DistributedCacheEntryOptions({ absoluteExpirationRelativeToNow: 1000 }));
    });
    this.configure(AbpExceptionHandlingOptions, (o) => {
      o.subscribers.add(RecordingSubscriber);
    });
  }
}

const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function createApp(store?: ThrowingStore) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance, skipConfigureServices: true });
  app.services.addTransient(RecordingSubscriber);
  if (store) app.services.addSingleton(IDistributedCacheStore, { useValue: store });
  await app.configureServices();
  await app.initialize();
  return app;
}

describe("distributed cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    RecordingSubscriber.errors = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gets, sets, refreshes and removes typed items (instances revived with their prototype)", async () => {
    const app = await createApp();
    const { books } = app.serviceProvider.getRequired(BookService);
    expect(await books.get("1")).toBeUndefined();

    await books.set("1", new BookCacheItem("DDD", 500));
    const cached = await books.get("1");
    expect(cached).toBeInstanceOf(BookCacheItem);
    expect(cached?.summary).toBe("DDD (500)");

    await books.remove("1");
    expect(await books.get("1")).toBeUndefined();

    await books.setMany([
      { key: "a", value: new BookCacheItem("A", 1) },
      { key: "b", value: new BookCacheItem("B", 2) },
    ]);
    const many = await books.getMany(["a", "missing", "b"]);
    expect(many.map((p) => [p.key, p.value?.name])).toEqual([
      ["a", "A"],
      ["missing", undefined],
      ["b", "B"],
    ]);
    await books.removeMany(["a", "b"]);
    expect((await books.getMany(["a", "b"])).every((p) => p.value === undefined)).toBe(true);
    await app.shutdown();
  });

  it("applies per-cache and global expiration options", async () => {
    const app = await createApp();
    const { books, shared } = app.serviceProvider.getRequired(BookService);
    const store = app.serviceProvider.getRequired(IDistributedCacheStore) as MemoryDistributedCacheStore;

    await books.set("1", new BookCacheItem("expires", 1));
    await shared.set("s", new SharedCacheItem("sliding"));
    expect(store.size).toBe(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(await books.get("1")).toBeDefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(await books.get("1")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(19 * 60 * 1000);
    await shared.refresh("s");
    await vi.advanceTimersByTimeAsync(19 * 60 * 1000);
    expect((await shared.get("s"))?.value).toBe("sliding");
    await vi.advanceTimersByTimeAsync(21 * 60 * 1000);
    expect(await shared.get("s")).toBeUndefined();

    await books.set("2", new BookCacheItem("custom", 1), new DistributedCacheEntryOptions({ slidingExpiration: 100 }));
    await vi.advanceTimersByTimeAsync(101);
    expect(await books.get("2")).toBeUndefined();
    await app.shutdown();
  });

  it("scopes keys by tenant unless the item ignores multi-tenancy", async () => {
    const app = await createApp();
    const { books, shared } = app.serviceProvider.getRequired(BookService);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    const normalizer = app.serviceProvider.getRequired(IDistributedCacheKeyNormalizer);

    expect(normalizer.normalizeKey(new DistributedCacheKeyNormalizeArgs("1", "Book", false))).toBe("c:Book,k:app:1");
    await currentTenant.run(tenantA, undefined, async () => {
      expect(normalizer.normalizeKey(new DistributedCacheKeyNormalizeArgs("1", "Book", false))).toBe(`t:${tenantA},c:Book,k:app:1`);
      expect(normalizer.normalizeKey(new DistributedCacheKeyNormalizeArgs("1", "Shared", true))).toBe("c:Shared,k:app:1");
      await books.set("1", new BookCacheItem("A's", 1));
      await shared.set("x", new SharedCacheItem("everyone"));
    });

    expect(await books.get("1")).toBeUndefined();
    expect((await shared.get("x"))?.value).toBe("everyone");
    await currentTenant.run(tenantB, undefined, async () => {
      expect(await books.get("1")).toBeUndefined();
      expect((await shared.get("x"))?.value).toBe("everyone");
    });
    await currentTenant.run(tenantA, undefined, async () => {
      expect((await books.get("1"))?.name).toBe("A's");
    });
    await app.shutdown();
  });

  it("defers considerUow changes to the unit of work completion", async () => {
    const app = await createApp();
    const { books } = app.serviceProvider.getRequired(BookService);
    const uowManager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    await books.set("kept", new BookCacheItem("kept", 1));

    const uow = uowManager.begin();
    try {
      await books.set("1", new BookCacheItem("pending", 1), undefined, { considerUow: true });
      await books.remove("kept", { considerUow: true });
      expect((await books.get("1", { considerUow: true }))?.name).toBe("pending");
      expect(await books.get("1")).toBeUndefined();
      expect((await books.get("kept"))?.name).toBe("kept");
      expect((await books.getMany(["1", "kept"], { considerUow: true })).map((p) => p.value?.name)).toEqual(["pending", "kept"]);
      await uow.complete();
    } finally {
      await uow.dispose();
    }
    expect((await books.get("1"))?.name).toBe("pending");
    expect(await books.get("kept")).toBeUndefined();

    const rolledBack = uowManager.begin();
    await books.set("2", new BookCacheItem("lost", 1), undefined, { considerUow: true });
    await rolledBack.dispose();
    expect(await books.get("2")).toBeUndefined();
    await app.shutdown();
  });

  it("getOrAdd runs the factory once for concurrent callers, getOrAddMany only for missing keys", async () => {
    const app = await createApp();
    const { books } = app.serviceProvider.getRequired(BookService);
    let calls = 0;
    const factory = async () => {
      calls++;
      await Promise.resolve();
      return new BookCacheItem("built", calls);
    };
    const [a, b, c] = await Promise.all([books.getOrAdd("k", factory), books.getOrAdd("k", factory), books.getOrAdd("k", factory)]);
    expect(calls).toBe(1);
    expect([a?.name, b?.name, c?.name]).toEqual(["built", "built", "built"]);
    expect((await books.getOrAdd("k", factory))?.pages).toBe(1);

    const keys = [new BookKey(1), new BookKey(2)];
    const cache = app.serviceProvider.getRequired(distributedCacheToken<BookCacheItem, BookKey>(BookCacheItem));
    await cache.set(keys[0]!, new BookCacheItem("one", 1));
    const result = await cache.getOrAddMany(keys, async (missing) => {
      expect(missing.map(String)).toEqual(["book-2"]);
      return missing.map((key) => ({ key, value: new BookCacheItem("two", 2) }));
    });
    expect(result.map((p) => p.value?.name)).toEqual(["one", "two"]);
    expect((await cache.get(new BookKey(2)))?.name).toBe("two");
    await app.shutdown();
  });

  it("hides store errors (logs + notifies) unless hideErrors is false", async () => {
    const store = new ThrowingStore();
    const app = await createApp(store);
    const { books } = app.serviceProvider.getRequired(BookService);
    store.fail = true;

    expect(await books.get("1")).toBeUndefined();
    await books.set("1", new BookCacheItem("x", 1));
    expect((await books.getMany(["1", "2"])).map((p) => p.value)).toEqual([undefined, undefined]);
    expect(RecordingSubscriber.errors).toHaveLength(3);
    expect((RecordingSubscriber.errors[0] as Error).message).toBe("store down");

    await expect(books.get("1", { hideErrors: false })).rejects.toThrow("store down");
    await expect(books.set("1", new BookCacheItem("x", 1), undefined, { hideErrors: false })).rejects.toThrow("store down");

    store.fail = false;
    await books.set("1", new BookCacheItem("x", 1));
    expect((await books.get("1"))?.name).toBe("x");
    await app.shutdown();
  });

  it("derives cache names from the decorator or the class name", () => {
    expect(CacheNameAttribute.getCacheName(BookCacheItem)).toBe("Book");
    expect(CacheNameAttribute.getCacheName(SharedCacheItem)).toBe("Shared");
    expect(CacheNameAttribute.getCacheName(class Plain {})).toBe("Plain");
  });
});
