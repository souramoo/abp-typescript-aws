import { AbpModule, DependsOn, IApplicationInfoAccessor, type ServiceConfigurationContext } from "@abp/core";
import { AbpDataModule } from "@abp/data";
import { AbpJsonModule } from "@abp/json";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpSecurityModule } from "@abp/security";
import { AbpTimingModule } from "@abp/timing";
import { AbpAuditingOptions } from "./abp-auditing-options.js";
import { AuditingInterceptorRegistrar } from "./auditing-interceptor.js";
import { AbpAuditingContractsModule } from "./contracts.js";
import "./audit-property-setter.js";
import "./audit-serializer.js";
import "./auditing-helper.js";
import "./auditing-manager.js";
import "./auditing-store.js";
import "./entity-history-helper.js";

/** Port of `AbpAuditingModule` (`AbpThreadingModule` has no counterpart: ambient scopes live in `@abp/core`). */
@DependsOn(AbpDataModule, AbpJsonModule, AbpTimingModule, AbpSecurityModule, AbpMultiTenancyModule, AbpAuditingContractsModule)
export class AbpAuditingModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(AuditingInterceptorRegistrar.registerIfNeeded);
  }

  override configureServices(context: ServiceConfigurationContext): void {
    const applicationName = context.services.getSingletonInstanceOrNull(IApplicationInfoAccessor)?.applicationName;
    if (applicationName) {
      this.configure(AbpAuditingOptions, (options) => {
        options.applicationName = applicationName;
      });
    }
  }
}
