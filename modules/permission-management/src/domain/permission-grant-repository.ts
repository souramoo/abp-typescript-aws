import { createToken, type Guid } from "@abp/core";
import type { IBasicRepository } from "@abp/ddd-domain";
import type { PermissionGrant } from "./permission-grant.js";

/** Port of `IPermissionGrantRepository`. The `GetListAsync` overloads are `getList(providerName, providerKey)` and `getListByNames`. */
export interface IPermissionGrantRepository extends IBasicRepository<PermissionGrant, Guid> {
  findGrant(name: string, providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant | undefined>;
  getListByProvider(providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant[]>;
  getListByNames(names: readonly string[], providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<PermissionGrant[]>;
}
export const IPermissionGrantRepository = createToken<IPermissionGrantRepository>("IPermissionGrantRepository");

/** The provider partition of a grant (`providerName#providerKey`), shared by the DynamoDB index and the in-memory filters. */
export function permissionGrantProviderKey(providerName: string, providerKey: string | undefined): string {
  return `${providerName}#${providerKey ?? ""}`;
}
