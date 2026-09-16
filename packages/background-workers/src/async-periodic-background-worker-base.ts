import { AbpException, ExceptionNotificationContext, IExceptionNotifier, IServiceProviderToken, forkAmbientScope, type IServiceProvider, type ServiceKey } from "@abp/core";
import { BackgroundWorkerBase } from "./background-worker.js";
import { PeriodicBackgroundWorkerContext } from "./periodic-background-worker-context.js";

/**
 * Port of `AsyncPeriodicBackgroundWorkerBase` with `AbpAsyncTimer` folded in: ticks never overlap (the next tick
 * is scheduled only after the current one finishes) and `runOnce()` executes a single tick without timers so a
 * scheduled Lambda can drive the worker.
 */
export abstract class AsyncPeriodicBackgroundWorkerBase extends BackgroundWorkerBase {
  static readonly inject: readonly ServiceKey[] = [IServiceProviderToken];

  /** Timer period in milliseconds (`AbpAsyncTimer.Period`). Must be set before `start()`. */
  period = 0;
  /** Runs a tick immediately on `start()` (`AbpAsyncTimer.RunOnStart`). Default: false. */
  runOnStart = false;

  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> | undefined;
  private startSignal: AbortSignal | undefined;
  private onDemandRuns = 0;

  constructor(protected readonly serviceScopeFactory: IServiceProvider) {
    super();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** True while a `runOnce()` call is executing (as opposed to a timer tick). */
  protected get isOnDemandRun(): boolean {
    return this.onDemandRuns > 0;
  }

  override async start(signal?: AbortSignal): Promise<void> {
    if (this.period <= 0) throw new AbpException("Period should be set before starting the timer!");
    this.startSignal = signal;
    await super.start(signal);
    this.running = true;
    this.schedule(this.runOnStart ? 0 : this.period);
  }

  override async stop(signal?: AbortSignal): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
    await super.stop(signal);
  }

  /** Executes one tick (scope + error handling) regardless of the timer state. */
  async runOnce(): Promise<void> {
    this.onDemandRuns++;
    try {
      await this.doWorkInScope();
    } finally {
      this.onDemandRuns--;
    }
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return;
    this.inFlight = this.doWorkInScope();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
      this.schedule(this.period);
    }
  }

  private async doWorkInScope(): Promise<void> {
    await forkAmbientScope(async () => {
      await using scope = this.serviceScopeFactory.createScope();
      try {
        await this.doWork(new PeriodicBackgroundWorkerContext(scope.serviceProvider, this.cancellationSignal()));
      } catch (e) {
        await scope.serviceProvider.getRequired(IExceptionNotifier).notify(new ExceptionNotificationContext(e));
        this.logger.logException(e);
      }
    });
  }

  private cancellationSignal(): AbortSignal {
    return this.startSignal ? AbortSignal.any([this.startSignal, this.stoppingSignal]) : this.stoppingSignal;
  }

  /** Periodic work is done by implementing this method. */
  protected abstract doWork(workerContext: PeriodicBackgroundWorkerContext): Promise<void>;
}
