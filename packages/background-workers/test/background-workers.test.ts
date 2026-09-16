import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbpApplication, AbpExceptionHandlingOptions, AbpModule, ApplicationInitializationContext, DependsOn, ExceptionSubscriber, IServiceProviderToken, NullLoggerFactory, Scoped, Singleton, type ExceptionNotificationContext, type IServiceProvider } from "@abp/core";
import { addDataMigrationEnvironment } from "@abp/data";
import {
  AbpBackgroundWorkerOptions,
  AbpBackgroundWorkersModule,
  AsyncPeriodicBackgroundWorkerBase,
  BackgroundWorkerBase,
  BackgroundWorkerName,
  BackgroundWorkerNameAttribute,
  IBackgroundWorkerManager,
  addBackgroundWorker,
  type PeriodicBackgroundWorkerContext,
} from "../src/index.js";

@Scoped()
class TickCounter {
  static instances = 0;
  constructor() {
    TickCounter.instances++;
  }
}

@Singleton()
@BackgroundWorkerName("Counter")
class CountingWorker extends AsyncPeriodicBackgroundWorkerBase {
  static override readonly inject = [IServiceProviderToken] as const;
  ticks = 0;
  signals: AbortSignal[] = [];
  failOnTick: number | undefined;

  constructor(serviceProvider: IServiceProvider) {
    super(serviceProvider);
    this.period = 10;
  }

  protected async doWork(context: PeriodicBackgroundWorkerContext): Promise<void> {
    context.serviceProvider.getRequired(TickCounter);
    this.ticks++;
    this.signals.push(context.signal);
    if (this.failOnTick === this.ticks) throw new Error("tick failed");
  }
}

@Singleton()
class PlainWorker extends BackgroundWorkerBase {
  started = 0;
  stopped = 0;
  override async start(): Promise<void> {
    this.started++;
  }
  override async stop(): Promise<void> {
    this.stopped++;
  }
}

class RecordingSubscriber extends ExceptionSubscriber {
  static errors: unknown[] = [];
  async handle(context: ExceptionNotificationContext): Promise<void> {
    RecordingSubscriber.errors.push(context.exception);
  }
}

@DependsOn(AbpBackgroundWorkersModule)
class TestModule extends AbpModule {
  static startOnInit = true;
  override configureServices(): void {
    this.configure(AbpBackgroundWorkerOptions, (o) => {
      o.startWorkersOnInitialization = TestModule.startOnInit;
    });
    this.configure(AbpExceptionHandlingOptions, (o) => {
      o.subscribers.add(RecordingSubscriber);
    });
  }
  override async onApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    await addBackgroundWorker(context, CountingWorker);
    await addBackgroundWorker(context, PlainWorker);
  }
}

async function createApp(startOnInit = true, migration = false) {
  TestModule.startOnInit = startOnInit;
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance, skipConfigureServices: true });
  if (migration) addDataMigrationEnvironment(app.services);
  app.services.addTransient(RecordingSubscriber);
  await app.configureServices();
  await app.initialize();
  return app;
}

describe("background workers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    RecordingSubscriber.errors = [];
    TickCounter.instances = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts added workers on initialization and ticks periodically without overlap", async () => {
    const app = await createApp();
    const worker = app.serviceProvider.getRequired(CountingWorker);
    const plain = app.serviceProvider.getRequired(PlainWorker);
    expect(plain.started).toBe(1);
    expect(worker.isRunning).toBe(true);
    expect(worker.ticks).toBe(0);

    await vi.advanceTimersByTimeAsync(10);
    expect(worker.ticks).toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    expect(worker.ticks).toBe(3);
    expect(TickCounter.instances).toBe(3);
    expect(worker.signals[0]!.aborted).toBe(false);

    await app.shutdown();
    expect(plain.stopped).toBe(1);
    expect(worker.isRunning).toBe(false);
    expect(worker.signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(worker.ticks).toBe(3);
  });

  it("reports tick failures to the exception notifier and keeps ticking", async () => {
    const app = await createApp();
    const worker = app.serviceProvider.getRequired(CountingWorker);
    worker.failOnTick = 1;
    await vi.advanceTimersByTimeAsync(20);
    expect(worker.ticks).toBe(2);
    expect(RecordingSubscriber.errors).toHaveLength(1);
    expect((RecordingSubscriber.errors[0] as Error).message).toBe("tick failed");
    await app.shutdown();
  });

  it("runOnce / runAllOnce execute a single tick without timers (serverless)", async () => {
    const app = await createApp(false);
    const worker = app.serviceProvider.getRequired(CountingWorker);
    expect(worker.isRunning).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(worker.ticks).toBe(0);

    await worker.runOnce();
    expect(worker.ticks).toBe(1);

    await app.serviceProvider.getRequired(IBackgroundWorkerManager).runAllOnce();
    expect(worker.ticks).toBe(2);
    expect(app.serviceProvider.getRequired(PlainWorker).started).toBe(0);
    await app.shutdown();
  });

  it("adding a worker after the manager started starts it immediately", async () => {
    const app = await createApp();
    const manager = app.serviceProvider.getRequired(IBackgroundWorkerManager);
    const late = new PlainWorker();
    await manager.add(late);
    expect(late.started).toBe(1);
    expect(manager.workers).toHaveLength(3);
    await app.shutdown();
    expect(late.stopped).toBe(1);
  });

  it("disables workers in a data migration environment", async () => {
    const app = await createApp(true, true);
    expect(app.serviceProvider.getOptions(AbpBackgroundWorkerOptions).isEnabled).toBe(false);
    expect(app.serviceProvider.getRequired(PlainWorker).started).toBe(0);
    await app.shutdown();
  });

  it("requires a period before starting and rejects non-workers", async () => {
    class NoPeriod extends AsyncPeriodicBackgroundWorkerBase {
      protected async doWork(): Promise<void> {}
    }
    const app = await createApp(false);
    await expect(new NoPeriod(app.serviceProvider).start()).rejects.toThrow("Period should be set");
    await expect(addBackgroundWorker(new ApplicationInitializationContext(app.serviceProvider), TickCounter as never)).rejects.toThrow("IBackgroundWorker");
    await app.shutdown();
  });

  it("resolves worker names from the decorator or the class name", () => {
    expect(BackgroundWorkerNameAttribute.getName(CountingWorker)).toBe("Counter");
    expect(BackgroundWorkerNameAttribute.getName(PlainWorker)).toBe("PlainWorker");
    expect(BackgroundWorkerNameAttribute.getNameOrNull(PlainWorker)).toBeUndefined();
  });
});
