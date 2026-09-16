import { Guid, Singleton } from "@abp/core";
import { RolePermissionValueProvider, UserPermissionValueProvider } from "@abp/authorization";
import { disableTracking } from "@abp/ddd-domain";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IUserRoleFinder } from "../../domain-shared/index.js";
import type { PermissionGrant } from "../permission-grant.js";
import { IPermissionGrantRepository } from "../permission-grant-repository.js";
import { MultiplePermissionValueProviderGrantInfo, PermissionManagementProvider, PermissionValueProviderGrantInfo } from "../permission-management-provider.js";

/**
 * Port of `RolePermissionManagementProvider`: grants keyed by role name; a check for a user (`U` + user id) also
 * reports the grants of the user's roles (resolved through `IUserRoleFinder`, implemented by the identity module).
 */
@Singleton()
export class RolePermissionManagementProvider extends PermissionManagementProvider {
  static override readonly inject = [IPermissionGrantRepository, IGuidGenerator, ICurrentTenant, IUserRoleFinder] as const;
  readonly name = RolePermissionValueProvider.ProviderName;

  constructor(
    permissionGrantRepository: IPermissionGrantRepository,
    guidGenerator: IGuidGenerator,
    currentTenant: ICurrentTenant,
    protected readonly userRoleFinder: IUserRoleFinder,
  ) {
    super(permissionGrantRepository, guidGenerator, currentTenant);
  }

  override async checkMany(names: readonly string[], providerName: string, providerKey: string | undefined): Promise<MultiplePermissionValueProviderGrantInfo> {
    using _tracking = disableTracking(this.permissionGrantRepository);
    const multiple = new MultiplePermissionValueProviderGrantInfo(names);
    const permissionGrants: PermissionGrant[] = [];

    if (providerName === this.name) permissionGrants.push(...(await this.permissionGrantRepository.getListByNames(names, providerName, providerKey)));

    if (providerName === UserPermissionValueProvider.ProviderName && providerKey !== undefined && Guid.isValid(providerKey)) {
      for (const roleName of await this.userRoleFinder.getRoleNames(Guid.parse(providerKey))) {
        permissionGrants.push(...(await this.permissionGrantRepository.getListByNames(names, this.name, roleName)));
      }
    }

    if (permissionGrants.length === 0) return multiple;

    const grantsByName = new Map<string, PermissionGrant>();
    for (const permissionGrant of permissionGrants) if (!grantsByName.has(permissionGrant.name)) grantsByName.set(permissionGrant.name, permissionGrant);

    for (const permissionName of names) {
      const permissionGrant = grantsByName.get(permissionName);
      if (permissionGrant) multiple.result.set(permissionName, new PermissionValueProviderGrantInfo(true, permissionGrant.providerKey));
    }
    return multiple;
  }
}
