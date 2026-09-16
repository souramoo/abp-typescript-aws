import { Check, type ServiceKey } from "@abp/core";
import { disableTracking } from "@abp/ddd-domain";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { PermissionGrant } from "./permission-grant.js";
import { IPermissionGrantRepository } from "./permission-grant-repository.js";

/** Port of `PermissionValueProviderGrantInfo`. */
export class PermissionValueProviderGrantInfo {
  static readonly NonGranted = new PermissionValueProviderGrantInfo(false);

  constructor(
    readonly isGranted: boolean,
    readonly providerKey?: string,
  ) {}
}

/** Port of `MultiplePermissionValueProviderGrantInfo` (`Result` is a `Map` of permission name to grant info). */
export class MultiplePermissionValueProviderGrantInfo {
  readonly result = new Map<string, PermissionValueProviderGrantInfo>();

  constructor(names?: readonly string[]) {
    if (names === undefined) return;
    for (const name of Check.notNull(names, "names")) this.result.set(name, PermissionValueProviderGrantInfo.NonGranted);
  }
}

/**
 * Port of `IPermissionManagementProvider`. Implementations are singletons in .NET (`ISingletonDependency` on the
 * interface); concrete classes here carry their own `@Singleton()` and are added to `PermissionManagementOptions.managementProviders`.
 */
export interface IPermissionManagementProvider {
  readonly name: string;
  check(name: string, providerName: string, providerKey: string | undefined): Promise<PermissionValueProviderGrantInfo>;
  checkMany(names: readonly string[], providerName: string, providerKey: string | undefined): Promise<MultiplePermissionValueProviderGrantInfo>;
  set(name: string, providerKey: string | undefined, isGranted: boolean): Promise<void>;
}

/** Port of `PermissionManagementProvider`: grants stored as `PermissionGrant` rows for `name`. */
export abstract class PermissionManagementProvider implements IPermissionManagementProvider {
  static readonly inject: readonly ServiceKey[] = [IPermissionGrantRepository, IGuidGenerator, ICurrentTenant];
  abstract readonly name: string;

  protected constructor(
    protected readonly permissionGrantRepository: IPermissionGrantRepository,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly currentTenant: ICurrentTenant,
  ) {}

  async check(name: string, providerName: string, providerKey: string | undefined): Promise<PermissionValueProviderGrantInfo> {
    const multiple = await this.checkMany([name], providerName, providerKey);
    return multiple.result.values().next().value ?? PermissionValueProviderGrantInfo.NonGranted;
  }

  async checkMany(names: readonly string[], providerName: string, providerKey: string | undefined): Promise<MultiplePermissionValueProviderGrantInfo> {
    using _tracking = disableTracking(this.permissionGrantRepository);
    const multiple = new MultiplePermissionValueProviderGrantInfo(names);
    if (providerName !== this.name) return multiple;

    const permissionGrants = await this.permissionGrantRepository.getListByNames(names, providerName, providerKey);
    const grantedPermissionNames = new Set(permissionGrants.map((x) => x.name));
    for (const permissionName of names) {
      multiple.result.set(permissionName, new PermissionValueProviderGrantInfo(grantedPermissionNames.has(permissionName), providerKey));
    }
    return multiple;
  }

  set(name: string, providerKey: string | undefined, isGranted: boolean): Promise<void> {
    return isGranted ? this.grant(name, providerKey) : this.revoke(name, providerKey);
  }

  protected async grant(name: string, providerKey: string | undefined): Promise<void> {
    const existing = await this.permissionGrantRepository.findGrant(name, this.name, providerKey);
    if (existing) return;
    await this.permissionGrantRepository.insert(new PermissionGrant(this.guidGenerator.create(), name, this.name, providerKey, this.currentTenant.id), true);
  }

  protected async revoke(name: string, providerKey: string | undefined): Promise<void> {
    const permissionGrant = await this.permissionGrantRepository.findGrant(name, this.name, providerKey);
    if (!permissionGrant) return;
    await this.permissionGrantRepository.delete(permissionGrant, true);
  }
}
