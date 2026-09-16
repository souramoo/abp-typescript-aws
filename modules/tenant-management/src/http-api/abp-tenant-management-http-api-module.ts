import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpTenantManagementApplicationContractsModule } from "../application-contracts/index.js";
import "./tenant-controller.js";

/**
 * Port of `AbpTenantManagementHttpApiModule`. The .NET dependency on `AbpFeatureManagementHttpApiModule` (and the
 * `AbpFeatureManagement`/`AbpUi` base localization resources) is not taken: feature management is a separate module.
 */
@DependsOn(AbpTenantManagementApplicationContractsModule, AbpAspNetCoreMvcModule)
export class AbpTenantManagementHttpApiModule extends AbpModule {}
