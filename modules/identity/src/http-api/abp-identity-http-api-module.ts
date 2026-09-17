import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpIdentityApplicationContractsModule } from "../application-contracts/index.js";
import "./controllers.js";

/** Port of `AbpIdentityHttpApiModule` (`AbpUiResource` has no counterpart in this port, so no base resource is added). */
@DependsOn(AbpIdentityApplicationContractsModule, AbpAspNetCoreMvcModule)
export class AbpIdentityHttpApiModule extends AbpModule {}
