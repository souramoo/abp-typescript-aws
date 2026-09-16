import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpBackgroundJobsDomainModule, BackgroundJobRecord, IBackgroundJobRepository } from "../domain/index.js";
import { BackgroundJobsMemoryDbContext } from "./background-jobs-memory-db-context.js";
import { MemoryBackgroundJobRepository } from "./memory-background-job-repository.js";

/** Registers the in-memory job repository (the memory-db counterpart of `AbpBackgroundJobsDynamoDbModule`). */
@DependsOn(AbpBackgroundJobsDomainModule, AbpMemoryDbModule)
export class AbpBackgroundJobsMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, BackgroundJobsMemoryDbContext, (options) => {
      options.addRepository(BackgroundJobRecord, MemoryBackgroundJobRepository);
    });
    context.services.addTransient(IBackgroundJobRepository, MemoryBackgroundJobRepository);
  }
}
