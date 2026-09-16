import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpTenantManagementDomainModule, ITenantRepository, Tenant } from "../domain/index.js";
import { MemoryTenantRepository } from "./memory-tenant-repository.js";
import { TenantManagementMemoryDbContext } from "./tenant-management-memory-db-context.js";

/** Registers the in-memory tenant repository (the memory-db counterpart of `AbpTenantManagementDynamoDbModule`). */
@DependsOn(AbpTenantManagementDomainModule, AbpMemoryDbModule)
export class AbpTenantManagementMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, TenantManagementMemoryDbContext, (options) => {
      options.addDefaultRepositories().addRepository(Tenant, MemoryTenantRepository);
    });
    context.services.addTransient(ITenantRepository, MemoryTenantRepository);
  }
}
