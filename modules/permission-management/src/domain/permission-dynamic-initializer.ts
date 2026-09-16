import { ILoggerFactory, IServiceProviderToken, Transient, type ILogger, type IServiceProvider } from "@abp/core";
import { IDynamicPermissionDefinitionStore } from "@abp/authorization";
import { PermissionManagementOptions } from "./permission-management-options.js";
import { IStaticPermissionSaver } from "./static-permission-saver.js";

/**
 * Port of `PermissionDynamicInitializer`. Saves the static permissions and pre-caches the dynamic store. The .NET
 * version runs in the background with an exponential retry policy (8 attempts, 8+ seconds apart); on serverless
 * hosts there is no background, so `initialize` runs once inline and logs failures instead of retrying.
 */
@Transient()
export class PermissionDynamicInitializer {
  static readonly inject = [IServiceProviderToken, ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(PermissionDynamicInitializer.name);
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    const options = this.serviceProvider.getOptions(PermissionManagementOptions);
    if (!options.saveStaticPermissionsToDatabase && !options.isDynamicPermissionStoreEnabled) return;
    try {
      if (signal?.aborted) return;
      await this.saveStaticPermissionsToDatabase(options);
      if (signal?.aborted) return;
      await this.preCacheDynamicPermissions(options);
    } catch {
      /* No need to log here since inner calls log */
    }
  }

  protected async saveStaticPermissionsToDatabase(options: PermissionManagementOptions): Promise<void> {
    if (!options.saveStaticPermissionsToDatabase) return;
    try {
      await this.serviceProvider.getRequired(IStaticPermissionSaver).save();
    } catch (e) {
      this.logger.logException(e);
      throw e;
    }
  }

  protected async preCacheDynamicPermissions(options: PermissionManagementOptions): Promise<void> {
    if (!options.isDynamicPermissionStoreEnabled) return;
    try {
      /* Pre-cache permissions, so first request doesn't wait */
      await this.serviceProvider.getRequired(IDynamicPermissionDefinitionStore).getGroups();
    } catch (e) {
      this.logger.logException(e);
      throw e;
    }
  }
}
