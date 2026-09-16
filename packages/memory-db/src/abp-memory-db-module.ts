import { AbpModule, DependsOn, ServiceLifetime, type ServiceConfigurationContext } from "@abp/core";
import { IConnectionStringResolver } from "@abp/data";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import { MemoryDatabaseManager } from "./memory-database.js";
import { UnitOfWorkMemoryDatabaseProvider, dbContextTypeOfProviderToken } from "./memory-database-provider.js";
import "./memory-database.js";

/**
 * Port of `AbpMemoryDbModule`. The open-generic `IMemoryDatabaseProvider<>` registration becomes a fallback resolver
 * for `memoryDatabaseProviderToken(DbContext)`; collections are created by `MemoryDatabase` directly.
 */
@DependsOn(AbpDddDomainModule)
export class AbpMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addFallbackResolver((key) => {
      const dbContextType = dbContextTypeOfProviderToken(key);
      if (!dbContextType) return undefined;
      return {
        lifetime: ServiceLifetime.Transient,
        implementation: {
          useFactory: (p) => new UnitOfWorkMemoryDatabaseProvider(p.getRequired(IUnitOfWorkManager), p.getRequired(IConnectionStringResolver), p.getRequired(dbContextType), p.getRequired(MemoryDatabaseManager), p.getRequired(ICurrentTenant), dbContextType),
        },
      };
    });
  }
}
