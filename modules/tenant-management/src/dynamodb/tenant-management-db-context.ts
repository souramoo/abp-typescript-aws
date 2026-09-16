import { ConnectionStringName } from "@abp/data";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { AbpTenantManagementDbProperties, Tenant } from "../domain/index.js";

/** Port of `TenantManagementMongoDbContext`: `Tenant` under `AbpTenants`, with `gsi2` keyed by `normalizedName`. */
@IgnoreMultiTenancy()
@ConnectionStringName(AbpTenantManagementDbProperties.ConnectionStringName)
export class TenantManagementDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder.entity(Tenant, (entity) => {
      entity.name(AbpTenantManagementDbProperties.dbTablePrefix + "Tenants");
      entity.index("gsi2", { pk: (tenant) => tenant.normalizedName });
    });
  }
}
