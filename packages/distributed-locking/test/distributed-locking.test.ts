import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { AbpDistributedLockOptions, AbpDistributedLockingModule, IAbpDistributedLock, IDistributedLockKeyNormalizer, LocalAbpDistributedLock, LocalKeyedLock, NullAbpDistributedLock } from "../src/index.js";

@DependsOn(AbpDistributedLockingModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpDistributedLockOptions, (o) => {
      o.keyPrefix = "app:";
    });
  }
}

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("LocalAbpDistributedLock", () => {
  it("grants mutual exclusion per name and releases on dispose", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);

    const first = await lock.tryAcquire("orders");
    expect(first).toBeDefined();
    expect(await lock.tryAcquire("orders")).toBeUndefined();
    expect(await lock.tryAcquire("customers")).toBeDefined();

    await first!.dispose();
    const again = await lock.tryAcquire("orders");
    expect(again).toBeDefined();
    await again!.dispose();
    await app.shutdown();
  });

  it("waits up to the timeout and hands the lock to the waiter", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);

    const holder = (await lock.tryAcquire("job"))!;
    const timedOut = await lock.tryAcquire("job", 20);
    expect(timedOut).toBeUndefined();

    const waiting = lock.tryAcquire("job", 1000);
    setTimeout(() => void holder.dispose(), 10);
    const handle = await waiting;
    expect(handle).toBeDefined();
    expect(await lock.tryAcquire("job")).toBeUndefined();
    await handle!.dispose();
    await app.shutdown();
  });

  it("rejects the wait when the signal aborts", async () => {
    const keyedLock = new LocalKeyedLock();
    const holder = (await keyedLock.tryLock("k"))!;
    const controller = new AbortController();
    const waiting = keyedLock.tryLock("k", 1000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    holder[Symbol.dispose]();
    expect(keyedLock.isLocked("k")).toBe(false);
  });

  it("normalizes names with the configured key prefix", async () => {
    const app = await createApp();
    const normalizer = app.serviceProvider.getRequired(IDistributedLockKeyNormalizer);
    expect(normalizer.normalizeKey("orders")).toBe("app:orders");

    const lock = app.serviceProvider.getRequired(LocalAbpDistributedLock);
    await using handle = await lock.tryAcquire("orders");
    expect(handle).toBeDefined();
    expect(lock["keyedLock"].isLocked("app:orders")).toBe(true);
    expect(lock["keyedLock"].isLocked("orders")).toBe(false);
    await app.shutdown();
  });

  it("supports `await using` and idempotent dispose", async () => {
    const lock = new LocalAbpDistributedLock({ normalizeKey: (n) => n });
    {
      await using handle = await lock.tryAcquire("x");
      expect(handle).toBeDefined();
      await handle!.dispose();
    }
    expect(await lock.tryAcquire("x")).toBeDefined();
  });

  it("NullAbpDistributedLock always acquires", async () => {
    const a = await NullAbpDistributedLock.instance.tryAcquire("x");
    const b = await NullAbpDistributedLock.instance.tryAcquire("x");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });
});
