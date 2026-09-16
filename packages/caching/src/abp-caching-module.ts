import { AbpModule, DependsOn, IAbpHostEnvironment, type ServiceConfigurationContext } from "@abp/core";
import { AbpJsonModule } from "@abp/json";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpUnitOfWorkModule } from "@abp/uow";
import { AbpDistributedCacheOptions } from "./abp-distributed-cache-options.js";
import { registerDistributedCaches } from "./distributed-cache.js";
import { IDistributedCacheStore, MemoryDistributedCacheStore } from "./distributed-cache-store.js";
import "./distributed-cache-key-normalizer.js";
import "./distributed-cache-serializer.js";

/**
 * Port of `AbpCachingModule`. Depends on the multi-tenancy abstractions (the key normalizer only needs
 * `ICurrentTenant`); `AbpThreadingModule`/`AbpSerializationModule` have no counterpart here. The hybrid cache
 * (`IHybridCache<T>`) is not ported.
 */
@DependsOn(AbpJsonModule, AbpMultiTenancyAbstractionsModule, AbpUnitOfWorkModule)
export class AbpCachingModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.tryAddSingleton(IDistributedCacheStore, MemoryDistributedCacheStore);

    this.configure(AbpDistributedCacheOptions, (cacheOptions) => {
      cacheOptions.globalCacheEntryOptions.slidingExpiration = 20 * 60 * 1000;
    });

    if (context.services.getSingletonInstanceOrNull(IAbpHostEnvironment)?.isDevelopment()) {
      this.configure(AbpDistributedCacheOptions, (options) => {
        options.hideErrors = false;
      });
    }
  }

  override postConfigureServices(context: ServiceConfigurationContext): void {
    registerDistributedCaches(context.services);
  }
}
