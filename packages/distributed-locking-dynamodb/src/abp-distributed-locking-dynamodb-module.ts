import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpDistributedLockingModule } from "@abp/distributed-locking";
import { AbpDynamoDbDistributedLockOptions } from "./abp-dynamodb-distributed-lock-options.js";
import "./dynamodb-client-factory.js";
import "./dynamodb-abp-distributed-lock.js";

/** Registers `DynamoDbAbpDistributedLock` in place of `LocalAbpDistributedLock` (the Medallion provider role in .NET). */
@DependsOn(AbpDistributedLockingModule)
export class AbpDistributedLockingDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpDynamoDbDistributedLockOptions, (options) => {
      options.tableName ??= configuration?.get("ConnectionStrings:Default") ?? process.env["ABP_DYNAMODB_TABLE"];
    });
  }
}
