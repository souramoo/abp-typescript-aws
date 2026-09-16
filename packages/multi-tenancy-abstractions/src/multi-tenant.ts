import { createClassMarker, type Guid } from "@abp/core";

/** Port of `IMultiTenant`: `undefined`/`null` tenant id means the host. */
export interface IMultiTenant {
  readonly tenantId?: Guid | null;
}

/** Name used by `@abp/data` to build the `IMultiTenant` data filter key (interfaces are erased at runtime). */
export const MultiTenantDataFilterName = "IMultiTenant";

export function isMultiTenant(value: unknown): value is IMultiTenant {
  return typeof value === "object" && value !== null && "tenantId" in value;
}

/** Port of `[IgnoreMultiTenancy]` as a class marker. */
export const IgnoreMultiTenancy = createClassMarker("IgnoreMultiTenancy");
