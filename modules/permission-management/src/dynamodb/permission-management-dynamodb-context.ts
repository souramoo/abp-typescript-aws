import { ConnectionStringName } from "@abp/data";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { AbpPermissionManagementDbProperties, PermissionDefinitionRecord, PermissionGrant, PermissionGroupDefinitionRecord, permissionGrantProviderKey } from "../domain/index.js";

/**
 * Port of `PermissionManagementMongoDbContext` / `IPermissionManagementMongoDbContext`. Key segments follow the
 * .NET collection names; `gsi2` serves the provider lookups of grants (`providerName#providerKey` → name) and the
 * name lookup of permission definition records.
 */
@ConnectionStringName(AbpPermissionManagementDbProperties.ConnectionStringName)
export class PermissionManagementDynamoDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    configurePermissionManagement(builder);
  }
}

/** Port of `AbpPermissionManagementMongoDbContextExtensions.ConfigurePermissionManagement`. */
export function configurePermissionManagement(builder: DynamoDbModelBuilder): void {
  builder
    .entity(PermissionGroupDefinitionRecord, (e) => {
      e.name(`${AbpPermissionManagementDbProperties.dbTablePrefix}PermissionGroups`);
    })
    .entity(PermissionDefinitionRecord, (e) => {
      e.name(`${AbpPermissionManagementDbProperties.dbTablePrefix}Permissions`).index("gsi2", { pk: (r) => r.name });
    })
    .entity(PermissionGrant, (e) => {
      e.name(`${AbpPermissionManagementDbProperties.dbTablePrefix}PermissionGrants`).index("gsi2", { pk: (g) => permissionGrantProviderKey(g.providerName, g.providerKey), sk: (g) => g.name });
    });
}
