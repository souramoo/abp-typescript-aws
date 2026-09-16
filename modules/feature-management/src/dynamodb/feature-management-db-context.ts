import { ConnectionStringName } from "@abp/data";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpFeatureManagementDbProperties, FeatureDefinitionRecord, FeatureGroupDefinitionRecord, FeatureValue } from "../domain/index.js";

/** The `gsi2` partition of a `FeatureValue`: every value of one provider/key pair (`GetListAsync(providerName, providerKey)`). */
export function featureProviderIndexKey(providerName: string | undefined, providerKey: string | undefined): string {
  return `${providerName ?? ""}#${providerKey ?? ""}`;
}

/** The `gsi3` partition of a `FeatureValue`: the exact value of a feature for a provider/key pair (`FindAsync`). */
export function featureLookupIndexKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
  return `${name}#${featureProviderIndexKey(providerName, providerKey)}`;
}

/**
 * Port of `FeatureManagementMongoDbContext`. Feature values are indexed by provider (`gsi2`) and by name + provider
 * (`gsi3`); definition records by name (`gsi2`).
 */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpFeatureManagementDbProperties.ConnectionStringName)
export class FeatureManagementDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder
      .entity(FeatureGroupDefinitionRecord, (e) => {
        e.name(`${AbpFeatureManagementDbProperties.dbTablePrefix}FeatureGroups`);
        e.index("gsi2", { pk: (r) => r.name });
      })
      .entity(FeatureDefinitionRecord, (e) => {
        e.name(`${AbpFeatureManagementDbProperties.dbTablePrefix}Features`);
        e.index("gsi2", { pk: (r) => r.name });
      })
      .entity(FeatureValue, (e) => {
        e.name(`${AbpFeatureManagementDbProperties.dbTablePrefix}FeatureValues`);
        e.index("gsi2", { pk: (v) => featureProviderIndexKey(v.providerName, v.providerKey) });
        e.index("gsi3", { pk: (v) => featureLookupIndexKey(v.name, v.providerName, v.providerKey) });
      });
  }
}
