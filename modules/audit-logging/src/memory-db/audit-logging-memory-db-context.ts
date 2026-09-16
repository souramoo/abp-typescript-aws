import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { AbpAuditLoggingDbProperties, AuditLog } from "../domain/index.js";

/** The in-memory counterpart of `AuditLoggingDbContext` (tests and local development). */
@ConnectionStringName(AbpAuditLoggingDbProperties.ConnectionStringName)
export class AuditLoggingMemoryDbContext extends MemoryDbContext {
  override readonly entities = [AuditLog];
}
