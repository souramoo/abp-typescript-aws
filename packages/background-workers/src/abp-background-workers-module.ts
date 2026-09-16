import { AbpModule, DependsOn, type ApplicationInitializationContext, type ApplicationShutdownContext, type ServiceConfigurationContext } from "@abp/core";
import { AbpDataModule, isDataMigrationEnvironment } from "@abp/data";
import { AbpBackgroundWorkerOptions } from "./abp-background-worker-options.js";
import { IBackgroundWorkerManager } from "./background-worker-manager.js";
import "./background-worker-manager.js";

/**
 * Port of `AbpBackgroundWorkersModule` (`AbpThreadingModule` lives in `@abp/core`). Workers are started in the
 * post-initialization phase so every module's `onApplicationInitialization` can add workers first, and only when
 * `AbpBackgroundWorkerOptions.startWorkersOnInitialization` is set (false in Lambda-style hosting).
 */
@DependsOn(AbpDataModule)
export class AbpBackgroundWorkersModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    if (isDataMigrationEnvironment(context.services)) {
      this.configure(AbpBackgroundWorkerOptions, (options) => {
        options.isEnabled = false;
      });
    }
  }

  override async onPostApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    const options = context.serviceProvider.getOptions(AbpBackgroundWorkerOptions);
    if (options.isEnabled && options.startWorkersOnInitialization) {
      await context.serviceProvider.getRequired(IBackgroundWorkerManager).start();
    }
  }

  override async onApplicationShutdown(context: ApplicationShutdownContext): Promise<void> {
    const options = context.serviceProvider.getOptions(AbpBackgroundWorkerOptions);
    if (options.isEnabled) {
      await context.serviceProvider.getRequired(IBackgroundWorkerManager).stop();
    }
  }
}
