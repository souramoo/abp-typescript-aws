import { ConnectionStringName } from "@abp/data";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpSettingManagementDbProperties, Setting, SettingDefinitionRecord } from "../domain/index.js";

/** The `gsi2` partition of a `Setting`: every value of one provider/key pair (`GetListAsync(providerName, providerKey)`). */
export function settingProviderIndexKey(providerName: string | undefined, providerKey: string | undefined): string {
  return `${providerName ?? ""}#${providerKey ?? ""}`;
}

/** The `gsi3` partition of a `Setting`: the exact value of a setting for a provider/key pair (`FindAsync`). */
export function settingLookupIndexKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
  return `${name}#${settingProviderIndexKey(providerName, providerKey)}`;
}

/**
 * Port of `SettingManagementMongoDbContext`. Settings are indexed by provider (`gsi2`) and by name + provider
 * (`gsi3`); definition records by name (`gsi2`).
 */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpSettingManagementDbProperties.ConnectionStringName)
export class SettingManagementDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder
      .entity(Setting, (e) => {
        e.name(`${AbpSettingManagementDbProperties.dbTablePrefix}Settings`);
        e.index("gsi2", { pk: (s) => settingProviderIndexKey(s.providerName, s.providerKey) });
        e.index("gsi3", { pk: (s) => settingLookupIndexKey(s.name, s.providerName, s.providerKey) });
      })
      .entity(SettingDefinitionRecord, (e) => {
        e.name(`${AbpSettingManagementDbProperties.dbTablePrefix}SettingDefinitions`);
        e.index("gsi2", { pk: (r) => r.name });
      });
  }
}
