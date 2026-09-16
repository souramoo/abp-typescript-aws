import { ConnectionStringName } from "@abp/data";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpBackgroundJobsDbProperties, BackgroundJobRecord } from "../domain/index.js";

/** The logical partition keys of the job indexes (the key builder scopes them as `<prefix>host#AbpBackgroundJobs#<value>`). */
export const BackgroundJobRecordIndexKeys = {
  /** `gsi2`: the jobs still waiting to run, sorted by `nextTryTime`. */
  waiting(applicationName: string | undefined): string {
    return `waiting#${applicationName ?? ""}`;
  },
  /** `gsi3`: the kept successful jobs, sorted by `completionTime`. */
  completed(applicationName: string | undefined): string {
    return `completed#${applicationName ?? ""}`;
  },
} as const;

/** Port of `BackgroundJobsMongoDbContext` (`AbpBackgroundJobs`), with the waiting/completed indexes the store queries. */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpBackgroundJobsDbProperties.ConnectionStringName)
export class BackgroundJobsDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder.entity(BackgroundJobRecord, (entity) => {
      entity.name(AbpBackgroundJobsDbProperties.dbTablePrefix + "BackgroundJobs");
      entity.index("gsi2", {
        pk: (record) => (record.isAbandoned || record.completionTime !== undefined ? undefined : BackgroundJobRecordIndexKeys.waiting(record.applicationName)),
        sk: (record) => record.nextTryTime.toISOString(),
      });
      entity.index("gsi3", {
        pk: (record) => (record.completionTime === undefined ? undefined : BackgroundJobRecordIndexKeys.completed(record.applicationName)),
        sk: (record) => record.completionTime?.toISOString(),
      });
    });
  }
}
