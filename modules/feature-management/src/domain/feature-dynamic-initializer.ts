import { ICancellationTokenProvider, ILoggerFactory, IServiceProviderToken, Transient, delay, type ILogger, type IServiceProvider } from "@abp/core";
import { IDynamicFeatureDefinitionStore } from "@abp/features";
import { FeatureManagementOptions } from "./feature-management-options.js";
import { IStaticFeatureSaver } from "./static-feature-saver.js";

/** Port of the Polly policy of `FeatureDynamicInitializer`: 8 retries, waiting `2^n * 8..12` seconds. */
const RetryCount = 8;

function retryDelayMs(retryAttempt: number): number {
  const factor = Math.pow(2, retryAttempt);
  const seconds = factor * 8 + Math.random() * factor * 4;
  return Math.round(seconds * 1000);
}

/**
 * Port of `FeatureDynamicInitializer`: saves the static features to the database and pre-caches the dynamic ones.
 * Failures are logged, never thrown (the application still starts).
 */
@Transient()
export class FeatureDynamicInitializer {
  static readonly inject = [IServiceProviderToken, ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(FeatureDynamicInitializer.name);
  }

  /** `runInBackground` returns immediately and retries failures with the .NET back-off; otherwise a single attempt is awaited. */
  async initialize(runInBackground: boolean, signal?: AbortSignal): Promise<void> {
    const options = this.serviceProvider.getOptions(FeatureManagementOptions);
    if (!options.saveStaticFeaturesToDatabase && !options.isDynamicFeatureStoreEnabled) return;

    if (runInBackground) {
      void this.executeInitialization(options, signal, RetryCount);
      return;
    }
    await this.executeInitialization(options, signal, 0);
  }

  protected async executeInitialization(options: FeatureManagementOptions, signal: AbortSignal | undefined, retryCount: number): Promise<void> {
    try {
      const cancellationTokenProvider = this.serviceProvider.getRequired(ICancellationTokenProvider);
      using _ = cancellationTokenProvider.use(signal);
      if (signal?.aborted) return;
      await this.saveStaticFeaturesToDatabase(options, signal, retryCount);
      if (signal?.aborted) return;
      await this.preCacheDynamicFeatures(options);
    } catch {
      /* the inner calls already logged the failure */
    }
  }

  protected async saveStaticFeaturesToDatabase(options: FeatureManagementOptions, signal: AbortSignal | undefined, retryCount: number): Promise<void> {
    if (!options.saveStaticFeaturesToDatabase) return;
    const staticFeatureSaver = this.serviceProvider.getRequired(IStaticFeatureSaver);

    for (let attempt = 0; ; attempt++) {
      try {
        await staticFeatureSaver.save();
        return;
      } catch (e) {
        this.logger.logException(e);
        if (attempt >= retryCount || signal?.aborted) throw e;
        await delay(retryDelayMs(attempt + 1), signal);
      }
    }
  }

  protected async preCacheDynamicFeatures(options: FeatureManagementOptions): Promise<void> {
    if (!options.isDynamicFeatureStoreEnabled) return;
    try {
      await this.serviceProvider.getRequired(IDynamicFeatureDefinitionStore).getGroups();
    } catch (e) {
      this.logger.logException(e);
      throw e;
    }
  }
}
