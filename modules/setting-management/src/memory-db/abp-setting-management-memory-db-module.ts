import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpSettingManagementDomainModule, ISettingDefinitionRecordRepository, ISettingRepository, Setting, SettingDefinitionRecord } from "../domain/index.js";
import { MemoryDbSettingDefinitionRecordRepository, MemoryDbSettingRepository } from "./memory-db-repositories.js";
import { SettingManagementMemoryDbContext } from "./setting-management-memory-db-context.js";

/** In-memory counterpart of `AbpSettingManagementDynamoDbModule`. */
@DependsOn(AbpSettingManagementDomainModule, AbpMemoryDbModule)
export class AbpSettingManagementMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, SettingManagementMemoryDbContext, (options) => {
      options.addDefaultRepositories().addRepository(Setting, MemoryDbSettingRepository).addRepository(SettingDefinitionRecord, MemoryDbSettingDefinitionRecordRepository);
    });
    context.services.addTransient(ISettingRepository, MemoryDbSettingRepository);
    context.services.addTransient(ISettingDefinitionRecordRepository, MemoryDbSettingDefinitionRecordRepository);
  }
}
