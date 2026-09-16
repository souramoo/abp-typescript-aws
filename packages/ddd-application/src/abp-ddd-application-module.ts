import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuditingContractsModule } from "@abp/auditing";
import { AbpAuthorizationModule } from "@abp/authorization";
import { AbpDataModule } from "@abp/data";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { AbpFeaturesModule } from "@abp/features";
import { AbpGlobalFeaturesModule } from "@abp/global-features";
import { AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpObjectMappingModule } from "@abp/object-mapping";
import { AbpSecurityModule } from "@abp/security";
import { AbpSettingsModule } from "@abp/settings";
import { AbpValidationModule } from "@abp/validation";
import { AbpDddApplicationContractsResource, abpDddApplicationContractsEn } from "./localization/abp-ddd-application-contracts-resource.js";

/** Port of `AbpDddApplicationContractsModule`. */
@DependsOn(AbpLocalizationModule, AbpAuditingContractsModule, AbpDataModule)
export class AbpDddApplicationContractsModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpDddApplicationContractsResource, "en").addJson(abpDddApplicationContractsEn);
    });
  }
}

/**
 * Port of `AbpDddApplicationModule`. `AbpHttpAbstractionsModule` (API description model options) belongs to the
 * HTTP layer here; `AbpDynamicSortingGuard` needs no installation because app services call it directly.
 */
@DependsOn(AbpDddDomainModule, AbpDddApplicationContractsModule, AbpSecurityModule, AbpObjectMappingModule, AbpValidationModule, AbpAuthorizationModule, AbpSettingsModule, AbpFeaturesModule, AbpGlobalFeaturesModule)
export class AbpDddApplicationModule extends AbpModule {}
