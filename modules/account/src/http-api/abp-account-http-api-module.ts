import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpIdentityHttpApiModule } from "@abp/identity/http-api";
import { AbpAccountApplicationContractsModule } from "../application-contracts/index.js";
import "./controllers.js";

/** Port of `AbpAccountHttpApiModule`. */
@DependsOn(AbpAccountApplicationContractsModule, AbpIdentityHttpApiModule, AbpAspNetCoreMvcModule)
export class AbpAccountHttpApiModule extends AbpModule {}
