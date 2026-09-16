import { AbpModule, DependsOn } from "@abp/core";
import { AbpAuditingModule } from "@abp/auditing";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { AbpHttpModule } from "@abp/http";
import { AbpJsonModule } from "@abp/json";
import { AbpAuditLoggingDomainSharedModule } from "../domain-shared/index.js";
import "./audit-log-entity-type-full-name-converter.js";
import "./audit-log-info-to-audit-log-converter.js";
import "./auditing-store.js";

/**
 * Port of `AbpAuditLoggingDomainModule`. `AbpExceptionHandlingModule` (the `IExceptionToErrorInfoConverter`) lives in
 * `@abp/http` here; the object-extension configuration step (`ModuleExtensionConfigurationHelper`) has no counterpart.
 */
@DependsOn(AbpAuditingModule, AbpDddDomainModule, AbpAuditLoggingDomainSharedModule, AbpHttpModule, AbpJsonModule)
export class AbpAuditLoggingDomainModule extends AbpModule {}
