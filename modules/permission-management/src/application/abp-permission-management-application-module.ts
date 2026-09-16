import { AbpModule, DependsOn } from "@abp/core";
import { AbpDddApplicationModule } from "@abp/ddd-application";
import { AbpPermissionManagementApplicationContractsModule } from "../application-contracts/index.js";
import { AbpPermissionManagementDomainModule } from "../domain/index.js";
import "./permission-app-service.js";
import "./permission-integration-service.js";

/** Port of `AbpPermissionManagementApplicationModule`. */
@DependsOn(AbpPermissionManagementDomainModule, AbpPermissionManagementApplicationContractsModule, AbpDddApplicationModule)
export class AbpPermissionManagementApplicationModule extends AbpModule {}
