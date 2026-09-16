import { AbpCommonDbProperties } from "@abp/data";

/** Port of `AbpBackgroundJobsDbProperties`. */
export class AbpBackgroundJobsDbProperties {
  static dbTablePrefix: string = AbpCommonDbProperties.dbTablePrefix;
  static dbSchema: string | undefined = AbpCommonDbProperties.dbSchema;
  static readonly ConnectionStringName = "AbpBackgroundJobs";
}
