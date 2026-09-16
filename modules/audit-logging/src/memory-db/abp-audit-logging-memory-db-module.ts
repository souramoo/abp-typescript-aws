import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpAuditLoggingDomainModule, AuditLog, IAuditLogRepository } from "../domain/index.js";
import { AuditLoggingMemoryDbContext } from "./audit-logging-memory-db-context.js";
import { MemoryAuditLogRepository } from "./memory-audit-log-repository.js";

/** Registers the in-memory audit log repository (the memory-db counterpart of `AbpAuditLoggingDynamoDbModule`). */
@DependsOn(AbpAuditLoggingDomainModule, AbpMemoryDbModule)
export class AbpAuditLoggingMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, AuditLoggingMemoryDbContext, (options) => {
      options.addRepository(AuditLog, MemoryAuditLogRepository);
    });
    context.services.addTransient(IAuditLogRepository, MemoryAuditLogRepository);
  }
}
