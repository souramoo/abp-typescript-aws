import { Singleton } from "@abp/core";
import { UserPermissionValueProvider } from "@abp/authorization";
import type { IGuidGenerator } from "@abp/guids";
import type { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import type { IPermissionGrantRepository } from "../permission-grant-repository.js";
import { PermissionManagementProvider } from "../permission-management-provider.js";

/** Port of `UserPermissionManagementProvider` (`Volo.Abp.PermissionManagement.Domain.Identity`): grants keyed by user id. */
@Singleton()
export class UserPermissionManagementProvider extends PermissionManagementProvider {
  readonly name = UserPermissionValueProvider.ProviderName;

  constructor(permissionGrantRepository: IPermissionGrantRepository, guidGenerator: IGuidGenerator, currentTenant: ICurrentTenant) {
    super(permissionGrantRepository, guidGenerator, currentTenant);
  }
}
