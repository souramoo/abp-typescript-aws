import { AbpCommonDbProperties } from "@abp/data";

/** Port of `AbpIdentityDbProperties`. */
export class AbpIdentityDbProperties {
  static dbTablePrefix: string = AbpCommonDbProperties.dbTablePrefix;
  static dbSchema: string | undefined = AbpCommonDbProperties.dbSchema;
  static readonly ConnectionStringName = "AbpIdentity";
}
