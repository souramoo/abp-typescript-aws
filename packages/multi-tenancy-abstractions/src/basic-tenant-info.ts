import type { Guid } from "@abp/core";

/** Port of `BasicTenantInfo`: `tenantId` undefined indicates the host. */
export class BasicTenantInfo {
  constructor(
    readonly tenantId: Guid | undefined,
    readonly name: string | undefined = undefined,
  ) {}
}
