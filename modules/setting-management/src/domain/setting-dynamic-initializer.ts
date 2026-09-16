import { ICancellationTokenProvider, ILoggerFactory, IServiceProviderToken, Transient, delay, type ILogger, type IServiceProvider } from "@abp/core";
import { IDynamicSettingDefinitionStore } from "@abp/settings";
import { SettingManagementOptions } from "./setting-management-options.js";
import { IStaticSettingSaver } from "./static-setting-saver.js";

/** Port of the Polly policy of `SettingDynamicInitializer`: 8 retries, waiting `2^n * 8..12` seconds. */
const RetryCount = 8;

function retryDelayMs(retryAttempt: number): number {
  const factor = Math.pow(2, retryAttempt);
  const seconds = factor * 8 + Math.random() * factor * 4;
  return Math.round(seconds * 1000);
}

/**
 * Port of `SettingDynamicInitializer`: saves the static settings to the database and pre-caches the dynamic ones.
 * Failures are logged, never thrown (the application still starts).
 */
@Transient()
export class SettingDynamicInitializer {
  static readonly inject = [IServiceProviderToken, ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(SettingDynamicInitializer.name);
  }

  /** `runInBackground` returns immediately and retries failures with the .NET back-off; otherwise a single attempt is awaited. */
  async initialize(runInBackground: boolean, signal?: AbortSignal): Promise<void> {
    const options = this.serviceProvider.getOptions(SettingManagementOptions);
    if (!options.saveStaticSettingsToDatabase && !options.isDynamicSettingStoreEnabled) return;

    if (runInBackground) {
      void this.executeInitialization(options, signal, RetryCount);
      return;
    }
    await this.executeInitialization(options, signal, 0);
  }

  protected async executeInitialization(options: SettingManagementOptions, signal: AbortSignal | undefined, retryCount: number): Promise<void> {
    try {
      const cancellationTokenProvider = this.serviceProvider.getRequired(ICancellationTokenProvider);
      using _ = cancellationTokenProvider.use(signal);
      if (signal?.aborted) return;
      await this.saveStaticSettingsToDatabase(options, signal, retryCount);
      if (signal?.aborted) return;
      await this.preCacheDynamicSettings(options);
    } catch {
      /* the inner calls already logged the failure */
    }
  }

  protected async saveStaticSettingsToDatabase(options: SettingManagementOptions, signal: AbortSignal | undefined, retryCount: number): Promise<void> {
    if (!options.saveStaticSettingsToDatabase) return;
    const staticSettingSaver = this.serviceProvider.getRequired(IStaticSettingSaver);

    for (let attempt = 0; ; attempt++) {
      try {
        await staticSettingSaver.save();
        return;
      } catch (e) {
        this.logger.logException(e);
        if (attempt >= retryCount || signal?.aborted) throw e;
        await delay(retryDelayMs(attempt + 1), signal);
      }
    }
  }

  protected async preCacheDynamicSettings(options: SettingManagementOptions): Promise<void> {
    if (!options.isDynamicSettingStoreEnabled) return;
    try {
      await this.serviceProvider.getRequired(IDynamicSettingDefinitionStore).getAll();
    } catch (e) {
      this.logger.logException(e);
      throw e;
    }
  }
}
