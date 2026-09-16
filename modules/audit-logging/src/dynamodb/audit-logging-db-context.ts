import { ConnectionStringName } from "@abp/data";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { AbpAuditLoggingDbProperties, AuditLog } from "../domain/index.js";

/**
 * Port of `AuditLoggingMongoDbContext`. `AuditLog` items live under `AbpAuditLogs` (per tenant); `gsi1` lists them by
 * id (UUID v7, so time-ordered), `gsi2` is keyed by `userId` and `gsi3` by `correlationId`, both sorted by `executionTime`.
 */
@ConnectionStringName(AbpAuditLoggingDbProperties.ConnectionStringName)
export class AuditLoggingDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder.entity(AuditLog, (entity) => {
      entity.name(AbpAuditLoggingDbProperties.dbTablePrefix + "AuditLogs");
      entity.index("gsi2", { pk: (log) => log.userId, sk: (log) => log.executionTime.toISOString() });
      entity.index("gsi3", { pk: (log) => log.correlationId, sk: (log) => log.executionTime.toISOString() });
    });
  }
}
