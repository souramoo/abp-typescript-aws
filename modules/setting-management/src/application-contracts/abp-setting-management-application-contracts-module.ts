import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuthorizationAbstractionsModule } from "@abp/authorization";
import { AbpDddApplicationContractsModule } from "@abp/ddd-application";
import { AbpSettingManagementDomainSharedModule } from "../domain-shared/index.js";
import "./setting-management-permissions.js";

/** Port of `AbpSettingManagementApplicationContractsModule`. */
@DependsOn(AbpSettingManagementDomainSharedModule, AbpDddApplicationContractsModule, AbpAuthorizationAbstractionsModule)
export class AbpSettingManagementApplicationContractsModule extends AbpModule {}
