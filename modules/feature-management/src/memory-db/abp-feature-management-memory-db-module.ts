import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpFeatureManagementDomainModule, FeatureDefinitionRecord, FeatureGroupDefinitionRecord, FeatureValue, IFeatureDefinitionRecordRepository, IFeatureGroupDefinitionRecordRepository, IFeatureValueRepository } from "../domain/index.js";
import { FeatureManagementMemoryDbContext } from "./feature-management-memory-db-context.js";
import { MemoryDbFeatureDefinitionRecordRepository, MemoryDbFeatureGroupDefinitionRecordRepository, MemoryDbFeatureValueRepository } from "./memory-db-repositories.js";

/** In-memory counterpart of `AbpFeatureManagementDynamoDbModule`. */
@DependsOn(AbpFeatureManagementDomainModule, AbpMemoryDbModule)
export class AbpFeatureManagementMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, FeatureManagementMemoryDbContext, (options) => {
      options
        .addDefaultRepositories()
        .addRepository(FeatureGroupDefinitionRecord, MemoryDbFeatureGroupDefinitionRecordRepository)
        .addRepository(FeatureDefinitionRecord, MemoryDbFeatureDefinitionRecordRepository)
        .addRepository(FeatureValue, MemoryDbFeatureValueRepository);
    });
    context.services.addTransient(IFeatureValueRepository, MemoryDbFeatureValueRepository);
    context.services.addTransient(IFeatureDefinitionRecordRepository, MemoryDbFeatureDefinitionRecordRepository);
    context.services.addTransient(IFeatureGroupDefinitionRecordRepository, MemoryDbFeatureGroupDefinitionRecordRepository);
  }
}
