import { Check, type Guid } from "@abp/core";
import { DisableAuditing } from "@abp/auditing";
import { EntityBase } from "@abp/ddd-domain";
import { TenantConnectionStringConsts } from "../domain-shared/index.js";

/** Port of `TenantConnectionString` (composite key `[tenantId, name]`, owned by `Tenant`). */
export class TenantConnectionString extends EntityBase {
  tenantId!: Guid;
  name!: string;
  @DisableAuditing()
  value!: string;

  constructor(tenantId: Guid, name: string, value: string) {
    super();
    if (tenantId === undefined) return;
    this.tenantId = tenantId;
    this.name = Check.notNullOrWhiteSpace(name, "name", TenantConnectionStringConsts.maxNameLength);
    this.setValue(value);
  }

  setValue(value: string): void {
    this.value = Check.notNullOrWhiteSpace(value, "value", TenantConnectionStringConsts.maxValueLength);
  }

  override getKeys(): readonly unknown[] {
    return [this.tenantId, this.name];
  }
}
