import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { AbpPermissionManagementDbProperties, PermissionDefinitionRecord, PermissionGrant, PermissionGroupDefinitionRecord } from "../domain/index.js";

/** The in-memory counterpart of `PermissionManagementDynamoDbContext` (tests and local runs). */
@ConnectionStringName(AbpPermissionManagementDbProperties.ConnectionStringName)
export class PermissionManagementMemoryDbContext extends MemoryDbContext {
  override readonly entities = [PermissionGroupDefinitionRecord, PermissionDefinitionRecord, PermissionGrant];
}
