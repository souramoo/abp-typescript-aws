import { AbpModule, DependsOn } from "@abp/core";
import { AbpDddApplicationModule } from "@abp/ddd-application";
import { AbpFeatureManagementApplicationContractsModule } from "../application-contracts/index.js";
import { AbpFeatureManagementDomainModule } from "../domain/index.js";
import "./feature-app-service.js";

/** Port of `AbpFeatureManagementApplicationModule`. */
@DependsOn(AbpFeatureManagementDomainModule, AbpFeatureManagementApplicationContractsModule, AbpDddApplicationModule)
export class AbpFeatureManagementApplicationModule extends AbpModule {}
