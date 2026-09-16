import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpTenantManagementDbProperties, Tenant } from "../domain/index.js";

/** The in-memory counterpart of `TenantManagementDbContext` (tests and local development). */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpTenantManagementDbProperties.ConnectionStringName)
export class TenantManagementMemoryDbContext extends MemoryDbContext {
  override readonly entities = [Tenant];
}
