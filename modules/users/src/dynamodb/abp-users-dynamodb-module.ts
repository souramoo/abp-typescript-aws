import { AbpModule, DependsOn } from "@abp/core";
import { AbpDynamoDbModule } from "@abp/dynamodb";
import { AbpUsersDomainModule } from "../domain/index.js";

/** Port of `AbpUsersMongoDbModule`. */
@DependsOn(AbpUsersDomainModule, AbpDynamoDbModule)
export class AbpUsersDynamoDbModule extends AbpModule {}
