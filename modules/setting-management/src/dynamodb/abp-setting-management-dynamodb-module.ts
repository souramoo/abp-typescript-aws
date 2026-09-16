import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpSettingManagementDomainModule, ISettingDefinitionRecordRepository, ISettingRepository, Setting, SettingDefinitionRecord } from "../domain/index.js";
import { DynamoDbSettingDefinitionRecordRepository, DynamoDbSettingRepository } from "./dynamodb-repositories.js";
import { SettingManagementDbContext } from "./setting-management-db-context.js";

/** Port of `AbpSettingManagementMongoDbModule`. */
@DependsOn(AbpSettingManagementDomainModule, AbpDynamoDbModule)
export class AbpSettingManagementDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, SettingManagementDbContext, (options) => {
      options.addDefaultRepositories().addRepository(Setting, DynamoDbSettingRepository).addRepository(SettingDefinitionRecord, DynamoDbSettingDefinitionRecordRepository);
    });
    context.services.addTransient(ISettingRepository, DynamoDbSettingRepository);
    context.services.addTransient(ISettingDefinitionRecordRepository, DynamoDbSettingDefinitionRecordRepository);
  }
}
