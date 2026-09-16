import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpPermissionManagementDomainModule, PermissionDefinitionRecord, PermissionGrant, PermissionGroupDefinitionRecord } from "../domain/index.js";
import { PermissionManagementDynamoDbContext } from "./permission-management-dynamodb-context.js";
import { DynamoDbPermissionDefinitionRecordRepository, DynamoDbPermissionGrantRepository, DynamoDbPermissionGroupDefinitionRecordRepository } from "./repositories.js";

/** Port of `AbpPermissionManagementMongoDbModule`. */
@DependsOn(AbpPermissionManagementDomainModule, AbpDynamoDbModule)
export class AbpPermissionManagementDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, PermissionManagementDynamoDbContext, (options) => {
      options
        .addDefaultRepositories()
        .addRepository(PermissionGroupDefinitionRecord, DynamoDbPermissionGroupDefinitionRecordRepository)
        .addRepository(PermissionDefinitionRecord, DynamoDbPermissionDefinitionRecordRepository)
        .addRepository(PermissionGrant, DynamoDbPermissionGrantRepository);
    });
  }
}
