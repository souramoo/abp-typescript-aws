import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpTenantManagementDomainModule, ITenantRepository, Tenant } from "../domain/index.js";
import { DynamoDbTenantRepository } from "./dynamodb-tenant-repository.js";
import { TenantManagementDbContext } from "./tenant-management-db-context.js";

/** Port of `AbpTenantManagementMongoDbModule`. */
@DependsOn(AbpTenantManagementDomainModule, AbpDynamoDbModule)
export class AbpTenantManagementDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, TenantManagementDbContext, (options) => {
      options.addDefaultRepositories().addRepository(Tenant, DynamoDbTenantRepository);
    });
    context.services.addTransient(ITenantRepository, DynamoDbTenantRepository);
  }
}
