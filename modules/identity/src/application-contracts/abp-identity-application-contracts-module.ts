import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuthorizationModule } from "@abp/authorization";
import { AbpDddApplicationContractsModule } from "@abp/ddd-application";
import { AbpPermissionManagementApplicationContractsModule } from "@abp/permission-management/application-contracts";
import { AbpUsersAbstractionModule } from "@abp/users/domain-shared";
import { AbpIdentityDomainSharedModule } from "../domain-shared/index.js";
import "./identity-permissions.js";

/** Port of `AbpIdentityApplicationContractsModule` (`ModuleExtensionConfigurationHelper.ApplyEntityConfigurationToApi` has no counterpart). */
@DependsOn(AbpIdentityDomainSharedModule, AbpUsersAbstractionModule, AbpAuthorizationModule, AbpPermissionManagementApplicationContractsModule, AbpDddApplicationContractsModule)
export class AbpIdentityApplicationContractsModule extends AbpModule {}
