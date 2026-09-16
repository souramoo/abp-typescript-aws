import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpBackgroundJobsDomainModule, BackgroundJobRecord, IBackgroundJobRepository } from "../domain/index.js";
import { BackgroundJobsDbContext } from "./background-jobs-db-context.js";
import { DynamoDbBackgroundJobRepository } from "./dynamodb-background-job-repository.js";

/** Port of `AbpBackgroundJobsMongoDbModule`. */
@DependsOn(AbpBackgroundJobsDomainModule, AbpDynamoDbModule)
export class AbpBackgroundJobsDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, BackgroundJobsDbContext, (options) => {
      options.addRepository(BackgroundJobRecord, DynamoDbBackgroundJobRepository);
    });
    context.services.addTransient(IBackgroundJobRepository, DynamoDbBackgroundJobRepository);
  }
}
