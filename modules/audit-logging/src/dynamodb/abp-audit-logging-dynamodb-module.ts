import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpAuditLoggingDomainModule, AuditLog, IAuditLogRepository } from "../domain/index.js";
import { AuditLoggingDbContext } from "./audit-logging-db-context.js";
import { DynamoDbAuditLogRepository } from "./dynamodb-audit-log-repository.js";

/** Port of `AbpAuditLoggingMongoDbModule` (the Excel export file repository is not ported). */
@DependsOn(AbpAuditLoggingDomainModule, AbpDynamoDbModule)
export class AbpAuditLoggingDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, AuditLoggingDbContext, (options) => {
      options.addRepository(AuditLog, DynamoDbAuditLogRepository);
    });
    context.services.addTransient(IAuditLogRepository, DynamoDbAuditLogRepository);
  }
}
