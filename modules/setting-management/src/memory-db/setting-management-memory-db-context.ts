import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpSettingManagementDbProperties, Setting, SettingDefinitionRecord } from "../domain/index.js";

/** In-memory counterpart of `SettingManagementDbContext` (tests, local development). */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpSettingManagementDbProperties.ConnectionStringName)
export class SettingManagementMemoryDbContext extends MemoryDbContext {
  override readonly entities = [Setting, SettingDefinitionRecord];
}
