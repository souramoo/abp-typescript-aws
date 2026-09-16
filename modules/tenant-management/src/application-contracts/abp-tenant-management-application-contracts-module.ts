import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuthorizationAbstractionsModule } from "@abp/authorization";
import { AbpDddApplicationContractsModule } from "@abp/ddd-application";
import { AbpTenantManagementDomainSharedModule } from "../domain-shared/index.js";
import "./abp-tenant-management-permission-definition-provider.js";

/** Port of `AbpTenantManagementApplicationContractsModule` (the object-extension API configuration step has no counterpart here). */
@DependsOn(AbpDddApplicationContractsModule, AbpTenantManagementDomainSharedModule, AbpAuthorizationAbstractionsModule)
export class AbpTenantManagementApplicationContractsModule extends AbpModule {}
