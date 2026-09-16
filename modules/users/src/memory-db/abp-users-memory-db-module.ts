import { AbpModule, DependsOn } from "@abp/core";
import { AbpMemoryDbModule } from "@abp/memory-db";
import { AbpUsersDomainModule } from "../domain/index.js";

/** The memory-db counterpart of `AbpUsersDynamoDbModule` (tests and local runs). */
@DependsOn(AbpUsersDomainModule, AbpMemoryDbModule)
export class AbpUsersMemoryDbModule extends AbpModule {}
