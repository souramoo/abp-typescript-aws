import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Transient, ServiceLifetime } from "@abp/core";
import {
  AbpUnitOfWorkDefaultOptions,
  AbpUnitOfWorkModule,
  ChildUnitOfWork,
  EventOrderGenerator,
  IUnitOfWorkEventPublisher,
  IUnitOfWorkManager,
  UnitOfWork,
  UnitOfWorkEnabled,
  UnitOfWorkEventRecord,
  UnitOfWorkHelper,
  UnitOfWorkTransactionBehavior,
  hasActiveChildUnitOfWorks,
  type ISupportsRollback,
  type ISupportsSavingChanges,
  type ITransactionApi,
  type IUnitOfWork,
} from "../src/index.js";

class FakeDbApi implements ISupportsSavingChanges, ISupportsRollback {
  readonly log: string[] = [];
  async saveChanges(): Promise<void> {
    this.log.push("save");
  }
  async rollback(): Promise<void> {
    this.log.push("rollback");
  }
}

class FakeTransaction implements ITransactionApi {
  readonly log: string[] = [];
  async commit(): Promise<void> {
    this.log.push("commit");
  }
  dispose(): void {
    this.log.push("dispose");
  }
}

class RecordingPublisher implements IUnitOfWorkEventPublisher {
  readonly published: string[] = [];
  uowForReentry: IUnitOfWork | undefined;
  async publishLocalEvents(events: readonly UnitOfWorkEventRecord[]): Promise<void> {
    for (const e of events) {
      this.published.push(`local:${String(e.eventData)}`);
      if (e.eventData === "first" && this.uowForReentry) {
        this.uowForReentry.addOrReplaceDistributedEvent(new UnitOfWorkEventRecord("Eto", "from-handler", EventOrderGenerator.getNext()));
        this.uowForReentry = undefined;
      }
    }
  }
  async publishDistributedEvents(events: readonly UnitOfWorkEventRecord[]): Promise<void> {
    for (const e of events) this.published.push(`distributed:${String(e.eventData)}`);
  }
}

@Transient()
@UnitOfWorkEnabled()
class OrderAppService {
  static readonly inject = [IUnitOfWorkManager] as const;
  seen: { current: IUnitOfWork | undefined; transactional: boolean | undefined }[] = [];
  constructor(private readonly unitOfWorkManager: IUnitOfWorkManager) {}

  async createOrder(): Promise<string> {
    this.record();
    return "created";
  }

  async getOrder(): Promise<void> {
    this.record();
  }

  @UnitOfWork({ isDisabled: true })
  async noUow(): Promise<void> {
    this.record();
  }

  @UnitOfWork({ isTransactional: false })
  async explicitlyNonTransactional(): Promise<void> {
    this.record();
  }

  private record(): void {
    const current = this.unitOfWorkManager.current;
    this.seen.push({ current, transactional: current?.options.isTransactional });
  }
}

@Transient()
class PlainService {
  async work(): Promise<void> {}
}

@DependsOn(AbpUnitOfWorkModule)
class TestModule extends AbpModule {}

async function createApp(publisher?: RecordingPublisher) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
  if (publisher) app.services.replace(IUnitOfWorkEventPublisher, { useValue: publisher }, ServiceLifetime.Singleton);
  await app.initialize();
  return app;
}

describe("IUnitOfWorkManager", () => {
  it("nested begin shares the outer unit of work, requiresNew creates an inner one", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    expect(manager.current).toBeUndefined();

    const outer = manager.begin({ isTransactional: true });
    try {
      expect(manager.current).toBe(outer);
      expect(outer.options.isTransactional).toBe(true);

      const child = manager.begin();
      expect(child).toBeInstanceOf(ChildUnitOfWork);
      expect(child.id).toBe(outer.id);
      expect(hasActiveChildUnitOfWorks(outer)).toBe(true);
      await child.complete();
      expect(outer.isCompleted).toBe(false);
      await child.dispose();
      expect(hasActiveChildUnitOfWorks(outer)).toBe(false);

      const inner = manager.begin(undefined, true);
      expect(inner).not.toBe(outer);
      expect(inner.outer).toBe(outer);
      expect(manager.current).toBe(inner);
      await inner.complete();
      await inner.dispose();
      expect(manager.current).toBe(outer);

      await outer.complete();
    } finally {
      await outer.dispose();
    }
    expect(manager.current).toBeUndefined();
    await app.shutdown();
  });

  it("complete saves changes, publishes events (including those added while publishing), commits and fires onCompleted", async () => {
    const publisher = new RecordingPublisher();
    const app = await createApp(publisher);
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const db = new FakeDbApi();
    const tx = new FakeTransaction();
    const order: string[] = [];

    const uow = manager.begin();
    try {
      expect(await uow.getOrAddDatabaseApi("db", () => db)).toBe(db);
      const [a, b] = await Promise.all([uow.getOrAddDatabaseApi("lazy", async () => new FakeDbApi()), uow.getOrAddDatabaseApi("lazy", async () => new FakeDbApi())]);
      expect(a).toBe(b);
      expect(uow.findDatabaseApi("lazy")).toBe(a);
      uow.addTransactionApi("tx", tx);
      expect(() => uow.addTransactionApi("tx", tx)).toThrow(/already contains/);

      publisher.uowForReentry = uow;
      uow.addOrReplaceLocalEvent(new UnitOfWorkEventRecord("E", "second", EventOrderGenerator.getNext()));
      uow.addOrReplaceLocalEvent(new UnitOfWorkEventRecord("E", "first", 0));
      uow.addOrReplaceLocalEvent(new UnitOfWorkEventRecord("E", "second-replaced", EventOrderGenerator.getNext()), (r) => r.eventData === "second");
      uow.addOrReplaceDistributedEvent(new UnitOfWorkEventRecord("Eto", "eto", EventOrderGenerator.getNext()));
      uow.onCompleted(async () => {
        order.push("completed");
      });
      uow.onDisposed(() => {
        order.push("disposed");
      });
      uow.onFailed(() => {
        order.push("failed");
      });

      await uow.complete();
      expect(uow.isCompleted).toBe(true);
      await expect(uow.complete()).rejects.toThrow(/already been requested/);
    } finally {
      await uow.dispose();
    }

    expect(publisher.published).toEqual(["local:first", "local:second-replaced", "distributed:eto", "distributed:from-handler"]);
    expect(db.log).toEqual(["save", "save", "save"]);
    expect(tx.log).toEqual(["commit", "dispose"]);
    expect(order).toEqual(["completed", "disposed"]);
    await app.shutdown();
  });

  it("dispose without complete rolls back and fires onFailed; explicit rollback skips complete", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const db = new FakeDbApi();
    const failures: { exception: unknown; isRolledback: boolean }[] = [];

    const uow = manager.begin();
    uow.addDatabaseApi("db", db);
    uow.onFailed((args) => {
      failures.push({ exception: args.exception, isRolledback: args.isRolledback });
    });
    await uow.dispose();
    expect(uow.isDisposed).toBe(true);
    expect(db.log).toEqual(["rollback"]);
    expect(failures).toEqual([{ exception: undefined, isRolledback: false }]);
    expect(manager.current).toBeUndefined();

    const db2 = new FakeDbApi();
    const uow2 = manager.begin();
    uow2.addDatabaseApi("db", db2);
    uow2.onFailed((args) => {
      failures.push({ exception: args.exception, isRolledback: args.isRolledback });
    });
    await uow2.rollback();
    await uow2.complete();
    expect(uow2.isCompleted).toBe(false);
    await uow2.dispose();
    expect(db2.log).toEqual(["rollback"]);
    expect(failures[1]).toEqual({ exception: undefined, isRolledback: true });
    await app.shutdown();
  });

  it("captures a failing complete in onFailed", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const uow = manager.begin();
    let captured: unknown;
    uow.onFailed((args) => {
      captured = args.exception;
    });
    uow.addDatabaseApi("db", {
      saveChanges: async () => {
        throw new Error("boom");
      },
    });
    await expect(uow.complete()).rejects.toThrow("boom");
    await uow.dispose();
    expect((captured as Error).message).toBe("boom");
    await app.shutdown();
  });

  it("reserve creates an invisible unit of work until it is begun", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const reserved = manager.reserve("_AbpActionUnitOfWork");
    try {
      expect(reserved.isReserved).toBe(true);
      expect(manager.current).toBeUndefined();
      expect(manager.tryBeginReserved("other")).toBe(false);
      expect(() => manager.beginReserved("other")).toThrow(/Could not find a reserved unit of work/);
      expect(manager.reserve("_AbpActionUnitOfWork")).toBeInstanceOf(ChildUnitOfWork);

      manager.beginReserved("_AbpActionUnitOfWork", { isTransactional: true });
      expect(reserved.isReserved).toBe(false);
      expect(manager.current).toBe(reserved);
      expect(reserved.options.isTransactional).toBe(true);
      await reserved.complete();
    } finally {
      await reserved.dispose();
    }
    await app.shutdown();
  });
});

describe("UnitOfWorkInterceptor", () => {
  it("wraps methods of marked classes per UnitOfWorkHelper rules and auto-decides transactions", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const service = app.serviceProvider.getRequired(OrderAppService);
    expect(UnitOfWorkHelper.isUnitOfWorkType(OrderAppService)).toBe(true);
    expect(UnitOfWorkHelper.isUnitOfWorkType(PlainService)).toBe(false);
    expect(app.services.getInterceptors(OrderAppService).length).toBe(1);
    expect(app.services.getInterceptors(PlainService).length).toBe(0);

    expect(await service.createOrder()).toBe("created");
    await service.getOrder();
    await service.noUow();
    await service.explicitlyNonTransactional();

    expect(service.seen.map((s) => [s.current !== undefined, s.transactional])).toEqual([
      [true, true],
      [true, false],
      [false, undefined],
      [true, false],
    ]);
    expect(manager.current).toBeUndefined();
    await app.shutdown();
  });

  it("joins an ambient unit of work instead of starting a new one", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IUnitOfWorkManager);
    const service = app.serviceProvider.getRequired(OrderAppService);
    const outer = manager.begin();
    try {
      await service.createOrder();
      expect(service.seen[0]?.current?.id).toBe(outer.id);
      await outer.complete();
    } finally {
      await outer.dispose();
    }
    await app.shutdown();
  });

  it("honours AbpUnitOfWorkDefaultOptions.transactionBehavior", async () => {
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    app.services.options.configure(AbpUnitOfWorkDefaultOptions, (o) => {
      o.transactionBehavior = UnitOfWorkTransactionBehavior.Disabled;
    });
    await app.initialize();
    const service = app.serviceProvider.getRequired(OrderAppService);
    await service.createOrder();
    expect(service.seen[0]?.transactional).toBe(false);
    await app.shutdown();
  });
});
