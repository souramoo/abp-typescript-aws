import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpFeatureManagementDomainModule, FeatureDefinitionRecord, FeatureGroupDefinitionRecord, FeatureValue, IFeatureDefinitionRecordRepository, IFeatureGroupDefinitionRecordRepository, IFeatureValueRepository } from "../domain/index.js";
import { DynamoDbFeatureDefinitionRecordRepository, DynamoDbFeatureGroupDefinitionRecordRepository, DynamoDbFeatureValueRepository } from "./dynamodb-repositories.js";
import { FeatureManagementDbContext } from "./feature-management-db-context.js";

/** Port of `AbpFeatureManagementMongoDbModule`. */
@DependsOn(AbpFeatureManagementDomainModule, AbpDynamoDbModule)
export class AbpFeatureManagementDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, FeatureManagementDbContext, (options) => {
      options
        .addDefaultRepositories()
        .addRepository(FeatureGroupDefinitionRecord, DynamoDbFeatureGroupDefinitionRecordRepository)
        .addRepository(FeatureDefinitionRecord, DynamoDbFeatureDefinitionRecordRepository)
        .addRepository(FeatureValue, DynamoDbFeatureValueRepository);
    });
    context.services.addTransient(IFeatureValueRepository, DynamoDbFeatureValueRepository);
    context.services.addTransient(IFeatureDefinitionRecordRepository, DynamoDbFeatureDefinitionRecordRepository);
    context.services.addTransient(IFeatureGroupDefinitionRecordRepository, DynamoDbFeatureGroupDefinitionRecordRepository);
  }
}
