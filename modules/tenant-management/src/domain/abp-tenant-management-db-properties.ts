import { AbpCommonDbProperties } from "@abp/data";

/** Port of `AbpTenantManagementDbProperties`. */
export class AbpTenantManagementDbProperties {
  static dbTablePrefix: string = AbpCommonDbProperties.dbTablePrefix;
  static dbSchema: string | undefined = AbpCommonDbProperties.dbSchema;
  static readonly ConnectionStringName = "AbpTenantManagement";
}
