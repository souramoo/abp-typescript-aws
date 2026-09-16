import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpPermissionManagementApplicationContractsModule } from "../application-contracts/index.js";
import "./permissions-controller.js";

/** Port of `AbpPermissionManagementHttpApiModule` (`AbpUiResource` has no counterpart in this port, so no base resource is added). */
@DependsOn(AbpPermissionManagementApplicationContractsModule, AbpAspNetCoreMvcModule)
export class AbpPermissionManagementHttpApiModule extends AbpModule {}
