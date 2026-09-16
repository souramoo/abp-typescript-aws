import { AbpModule, DependsOn } from "@abp/core";
import { AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationModule, AbpValidationResource } from "@abp/validation";
import { AuditLoggingResource, auditLoggingEn } from "./localization.js";

/** Port of `AbpAuditLoggingDomainSharedModule` (the virtual file system is replaced by the inlined `en.json`). */
@DependsOn(AbpValidationModule)
export class AbpAuditLoggingDomainSharedModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AuditLoggingResource, "en").addBaseTypes(AbpValidationResource).addJson(auditLoggingEn);
    });
  }
}
