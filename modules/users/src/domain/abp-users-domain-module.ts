import { AbpModule, DependsOn } from "@abp/core";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { AbpUsersAbstractionModule, AbpUsersDomainSharedModule } from "../domain-shared/index.js";

/** Port of `AbpUsersDomainModule`. */
@DependsOn(AbpUsersDomainSharedModule, AbpUsersAbstractionModule, AbpDddDomainModule)
export class AbpUsersDomainModule extends AbpModule {}
