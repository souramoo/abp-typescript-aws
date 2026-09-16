import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpFeatureManagementApplicationContractsModule } from "../application-contracts/index.js";
import "./features-controller.js";

/** Port of `AbpFeatureManagementHttpApiModule` (`AbpUiResource` and the MVC JSON converter have no counterpart: `FeatureDto.valueType` is already JSON). */
@DependsOn(AbpFeatureManagementApplicationContractsModule, AbpAspNetCoreMvcModule)
export class AbpFeatureManagementHttpApiModule extends AbpModule {}
