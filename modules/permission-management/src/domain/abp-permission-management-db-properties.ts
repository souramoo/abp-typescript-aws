import { AbpCommonDbProperties } from "@abp/data";

/** Port of `AbpPermissionManagementDbProperties`. */
export class AbpPermissionManagementDbProperties {
  static dbTablePrefix: string = AbpCommonDbProperties.dbTablePrefix;
  static dbSchema: string | undefined = AbpCommonDbProperties.dbSchema;
  static readonly ConnectionStringName = "AbpPermissionManagement";
}
