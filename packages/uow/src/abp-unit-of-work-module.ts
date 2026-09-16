import { AbpModule, ServiceLifetime, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { UnitOfWorkInterceptorRegistrar } from "./unit-of-work-interceptor.js";
import { AlwaysDisableTransactionsUnitOfWorkManager, IUnitOfWorkManager } from "./unit-of-work-manager.js";

/** Port of `AbpUnitOfWorkModule`. */
export class AbpUnitOfWorkModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(UnitOfWorkInterceptorRegistrar.registerIfNeeded);
  }
}

/** Port of `UnitOfWorkCollectionExtensions.AddAlwaysDisableUnitOfWorkTransaction`. */
export function addAlwaysDisableUnitOfWorkTransaction(services: ServiceCollection): ServiceCollection {
  return services.replace(IUnitOfWorkManager, AlwaysDisableTransactionsUnitOfWorkManager, ServiceLifetime.Singleton);
}
