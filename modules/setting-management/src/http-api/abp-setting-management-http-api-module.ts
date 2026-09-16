import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpSettingManagementApplicationContractsModule } from "../application-contracts/index.js";
import "./email-settings-controller.js";
import "./time-zone-settings-controller.js";

/** Port of `AbpSettingManagementHttpApiModule` (`AbpUiResource` has no counterpart in this runtime). */
@DependsOn(AbpSettingManagementApplicationContractsModule, AbpAspNetCoreMvcModule)
export class AbpSettingManagementHttpApiModule extends AbpModule {}
