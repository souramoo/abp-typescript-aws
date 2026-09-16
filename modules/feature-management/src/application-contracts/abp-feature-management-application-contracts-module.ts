import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuthorizationAbstractionsModule } from "@abp/authorization";
import { AbpDddApplicationContractsModule } from "@abp/ddd-application";
import { AbpJsonModule } from "@abp/json";
import { AbpFeatureManagementDomainSharedModule } from "../domain-shared/index.js";
import "./feature-management-permissions.js";

/** Port of `AbpFeatureManagementApplicationContractsModule`. */
@DependsOn(AbpFeatureManagementDomainSharedModule, AbpDddApplicationContractsModule, AbpAuthorizationAbstractionsModule, AbpJsonModule)
export class AbpFeatureManagementApplicationContractsModule extends AbpModule {}
