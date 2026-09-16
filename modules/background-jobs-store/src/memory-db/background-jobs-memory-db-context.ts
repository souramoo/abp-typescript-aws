import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpBackgroundJobsDbProperties, BackgroundJobRecord } from "../domain/index.js";

/** The in-memory counterpart of `BackgroundJobsDbContext` (tests and local development). */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpBackgroundJobsDbProperties.ConnectionStringName)
export class BackgroundJobsMemoryDbContext extends MemoryDbContext {
  override readonly entities = [BackgroundJobRecord];
}
