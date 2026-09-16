import { Check, type Guid } from "@abp/core";
import { Entity } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";

/** Port of `PermissionGrant`: one granted permission for a provider (`U`ser, `R`ole, `C`lient, …) and its key. */
export class PermissionGrant extends Entity<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  name!: string;
  providerName!: string;
  /** `protected internal set` in .NET: only `PermissionManager.updateProviderKey` is meant to change it. */
  providerKey: string | undefined = undefined;

  constructor(id?: Guid, name?: string, providerName?: string, providerKey?: string, tenantId?: Guid) {
    super(id);
    if (id === undefined) return;
    this.name = Check.notNullOrWhiteSpace(name, "name");
    this.providerName = Check.notNullOrWhiteSpace(providerName, "providerName");
    this.providerKey = providerKey;
    this.tenantId = tenantId;
  }
}
