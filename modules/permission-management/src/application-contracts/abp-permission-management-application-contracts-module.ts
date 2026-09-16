import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuthorizationAbstractionsModule } from "@abp/authorization";
import { AbpDddApplicationContractsModule } from "@abp/ddd-application";
import { AbpPermissionManagementDomainSharedModule } from "../domain-shared/index.js";

/** Port of `AbpPermissionManagementApplicationContractsModule`. */
@DependsOn(AbpDddApplicationContractsModule, AbpPermissionManagementDomainSharedModule, AbpAuthorizationAbstractionsModule)
export class AbpPermissionManagementApplicationContractsModule extends AbpModule {}
