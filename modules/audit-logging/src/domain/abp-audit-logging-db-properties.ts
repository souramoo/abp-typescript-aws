import { AbpCommonDbProperties } from "@abp/data";

/** Port of `AbpAuditLoggingDbProperties`. */
export class AbpAuditLoggingDbProperties {
  static dbTablePrefix: string = AbpCommonDbProperties.dbTablePrefix;
  static dbSchema: string | undefined = AbpCommonDbProperties.dbSchema;
  static readonly ConnectionStringName = "AbpAuditLogging";
}
