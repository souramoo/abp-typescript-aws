import { AbpModule, DependsOn } from "@abp/core";
import { AbpEventBusModule } from "@abp/event-bus";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";

/** Port of `AbpUsersAbstractionModule` (the `Volo.Abp.Users.Abstractions` assembly is folded into this layer). */
@DependsOn(AbpMultiTenancyModule, AbpEventBusModule)
export class AbpUsersAbstractionModule extends AbpModule {}

/** Port of `AbpUsersDomainSharedModule`. */
export class AbpUsersDomainSharedModule extends AbpModule {}
