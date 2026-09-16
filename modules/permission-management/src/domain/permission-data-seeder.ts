import { Transient, createToken, type Guid } from "@abp/core";
import { IPermissionDefinitionManager, RolePermissionValueProvider } from "@abp/authorization";
import { DataSeedContributor, type DataSeedContext, type IDataSeedContributor } from "@abp/data";
import { disableTracking } from "@abp/ddd-domain";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant, getMultiTenancySide, hasMultiTenancySide } from "@abp/multi-tenancy-abstractions";
import { AbpRoleConsts } from "@abp/security";
import { PermissionGrant } from "./permission-grant.js";
import { IPermissionGrantRepository } from "./permission-grant-repository.js";

/** Port of `IPermissionDataSeeder`. */
export interface IPermissionDataSeeder {
  seed(providerName: string, providerKey: string, grantedPermissions: Iterable<string>, tenantId?: Guid): Promise<void>;
}
export const IPermissionDataSeeder = createToken<IPermissionDataSeeder>("IPermissionDataSeeder");

/** Port of `PermissionDataSeeder`: inserts the missing grants for a provider key. */
@Transient(IPermissionDataSeeder)
export class PermissionDataSeeder implements IPermissionDataSeeder {
  static readonly inject = [IPermissionGrantRepository, IGuidGenerator, ICurrentTenant] as const;

  constructor(
    protected readonly permissionGrantRepository: IPermissionGrantRepository,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly currentTenant: ICurrentTenant,
  ) {}

  async seed(providerName: string, providerKey: string, grantedPermissions: Iterable<string>, tenantId?: Guid): Promise<void> {
    await this.currentTenant.run(tenantId, undefined, async () => {
      using _tracking = disableTracking(this.permissionGrantRepository);
      const names = [...grantedPermissions];
      const existing = new Set((await this.permissionGrantRepository.getListByNames(names, providerName, providerKey)).map((x) => x.name));
      const permissions = names.filter((name) => !existing.has(name)).map((name) => new PermissionGrant(this.guidGenerator.create(), name, providerName, providerKey, tenantId));
      if (permissions.length === 0) return;
      await this.permissionGrantRepository.insertMany(permissions);
    });
  }
}

/** Port of `PermissionDataSeedContributor`: grants every role-compatible permission of the current side to the `admin` role. */
@Transient()
@DataSeedContributor()
export class PermissionDataSeedContributor implements IDataSeedContributor {
  static readonly inject = [IPermissionDefinitionManager, IPermissionDataSeeder, ICurrentTenant] as const;

  constructor(
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    protected readonly permissionDataSeeder: IPermissionDataSeeder,
    protected readonly currentTenant: ICurrentTenant,
  ) {}

  async seed(context: DataSeedContext): Promise<void> {
    const multiTenancySide = getMultiTenancySide(this.currentTenant);
    const permissionNames = (await this.permissionDefinitionManager.getPermissions())
      .filter((p) => hasMultiTenancySide(p.multiTenancySide, multiTenancySide))
      .filter((p) => p.providers.length === 0 || p.providers.includes(RolePermissionValueProvider.ProviderName))
      .map((p) => p.name);

    await this.permissionDataSeeder.seed(RolePermissionValueProvider.ProviderName, AbpRoleConsts.adminRoleName, permissionNames, context.tenantId);
  }
}
