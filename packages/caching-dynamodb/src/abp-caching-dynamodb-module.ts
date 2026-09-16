import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpCachingModule } from "@abp/caching";
import { AbpDynamoDbCacheOptions } from "./abp-dynamodb-cache-options.js";
import "./dynamodb-client-factory.js";
import "./dynamodb-distributed-cache-store.js";

/** Registers `DynamoDbDistributedCacheStore` in place of the in-memory store of `AbpCachingModule`. */
@DependsOn(AbpCachingModule)
export class AbpCachingDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpDynamoDbCacheOptions, (options) => {
      options.tableName ??= configuration?.get("ConnectionStrings:Default") ?? process.env["ABP_DYNAMODB_TABLE"];
    });
  }
}
