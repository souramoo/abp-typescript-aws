import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpPermissionManagementDomainModule, PermissionDefinitionRecord, PermissionGrant, PermissionGroupDefinitionRecord } from "../domain/index.js";
import { PermissionManagementMemoryDbContext } from "./permission-management-memory-db-context.js";
import { MemoryDbPermissionDefinitionRecordRepository, MemoryDbPermissionGrantRepository, MemoryDbPermissionGroupDefinitionRecordRepository } from "./repositories.js";

/** The memory-db counterpart of `AbpPermissionManagementDynamoDbModule`. */
@DependsOn(AbpPermissionManagementDomainModule, AbpMemoryDbModule)
export class AbpPermissionManagementMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, PermissionManagementMemoryDbContext, (options) => {
      options
        .addDefaultRepositories()
        .addRepository(PermissionGroupDefinitionRecord, MemoryDbPermissionGroupDefinitionRecordRepository)
        .addRepository(PermissionDefinitionRecord, MemoryDbPermissionDefinitionRecordRepository)
        .addRepository(PermissionGrant, MemoryDbPermissionGrantRepository);
    });
  }
}
