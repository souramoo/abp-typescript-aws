import { AbpModule, DependsOn } from "@abp/core";
import { AbpDddApplicationModule } from "@abp/ddd-application";
import { AbpEmailingModule } from "@abp/emailing";
import { AbpTimingModule } from "@abp/timing";
import { AbpSettingManagementApplicationContractsModule } from "../application-contracts/index.js";
import { AbpSettingManagementDomainModule } from "../domain/index.js";
import "./email-settings-app-service.js";
import "./time-zone-settings-app-service.js";
import "./timing-setting-definition-provider.js";

/**
 * Port of `AbpSettingManagementApplicationModule`. `AbpUsersAbstractionModule` (and the `UserDeletedEventHandler`
 * that clears a deleted user's settings) is not ported because there is no users package in this runtime yet.
 */
@DependsOn(AbpDddApplicationModule, AbpSettingManagementDomainModule, AbpSettingManagementApplicationContractsModule, AbpEmailingModule, AbpTimingModule)
export class AbpSettingManagementApplicationModule extends AbpModule {}
