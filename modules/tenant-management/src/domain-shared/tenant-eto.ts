import type { Guid } from "@abp/core";
import type { IHasEntityVersion } from "@abp/auditing";
import { EtoBase, EventName } from "@abp/event-bus";

/** Port of `TenantEto`: the distributed event transfer object of `Tenant`. */
export class TenantEto implements IHasEntityVersion {
  id!: Guid;
  name!: string;
  entityVersion = 0;
}

/**
 * Port of `Volo.Abp.MultiTenancy.TenantCreatedEto` (published by `TenantAppService.create` with the `AdminEmail` /
 * `AdminPassword` properties). It lives in the framework in .NET; `@abp/multi-tenancy` does not ship it, so it is here.
 */
@EventName("abp.multi_tenancy.tenant.created")
export class TenantCreatedEto extends EtoBase {
  id!: Guid;
  name!: string;

  constructor(init?: { id: Guid; name: string; properties?: Record<string, string> }) {
    super();
    if (init) {
      this.id = init.id;
      this.name = init.name;
      if (init.properties) this.properties = { ...init.properties };
    }
  }
}
