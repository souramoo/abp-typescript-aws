import { createToken } from "@abp/core";
import type { IApplicationService, ListResultDto } from "@abp/ddd-application";
import type { IsGrantedRequest, IsGrantedResponse } from "../domain-shared/index.js";
import type { GetPermissionListResultDto, UpdatePermissionsDto } from "./dtos.js";

/** Port of `PermissionManagementRemoteServiceConsts`. */
export const PermissionManagementRemoteServiceConsts = {
  RemoteServiceName: "AbpPermissionManagement",
  ModuleName: "permissionManagement",
} as const;

/**
 * Port of `IPermissionAppService`. The resource permission members (`GetResourceProviderKeyLookupServicesAsync`,
 * `GetResourceAsync`, …) are not ported: resource permissions are out of scope of this port.
 */
export interface IPermissionAppService extends IApplicationService {
  get(providerName: string, providerKey: string): Promise<GetPermissionListResultDto>;
  getByGroup(groupName: string, providerName: string, providerKey: string): Promise<GetPermissionListResultDto>;
  update(providerName: string, providerKey: string, input: UpdatePermissionsDto): Promise<void>;
}
export const IPermissionAppService = createToken<IPermissionAppService>("IPermissionAppService");

/** Port of `IPermissionIntegrationService` (`[IntegrationService]`). */
export interface IPermissionIntegrationService extends IApplicationService {
  isGranted(input: readonly IsGrantedRequest[]): Promise<ListResultDto<IsGrantedResponse>>;
}
export const IPermissionIntegrationService = createToken<IPermissionIntegrationService>("IPermissionIntegrationService");
