import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpFeatureManagementDbProperties, FeatureDefinitionRecord, FeatureGroupDefinitionRecord, FeatureValue } from "../domain/index.js";

/** In-memory counterpart of `FeatureManagementDbContext` (tests, local development). */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpFeatureManagementDbProperties.ConnectionStringName)
export class FeatureManagementMemoryDbContext extends MemoryDbContext {
  override readonly entities = [FeatureGroupDefinitionRecord, FeatureDefinitionRecord, FeatureValue];
}
