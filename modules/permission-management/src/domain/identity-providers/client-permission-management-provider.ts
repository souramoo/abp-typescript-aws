import { Singleton } from "@abp/core";
import { ClientPermissionValueProvider } from "@abp/authorization";
import type { IGuidGenerator } from "@abp/guids";
import type { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import type { IPermissionGrantRepository } from "../permission-grant-repository.js";
import { PermissionManagementProvider, type MultiplePermissionValueProviderGrantInfo, type PermissionValueProviderGrantInfo } from "../permission-management-provider.js";

/**
 * Port of `ApplicationPermissionManagementProvider` (`Volo.Abp.PermissionManagement.Domain.OpenIddict`), named after
 * the value provider it manages (`C`): client grants always live on the host side.
 */
@Singleton()
export class ClientPermissionManagementProvider extends PermissionManagementProvider {
  readonly name = ClientPermissionValueProvider.ProviderName;

  constructor(permissionGrantRepository: IPermissionGrantRepository, guidGenerator: IGuidGenerator, currentTenant: ICurrentTenant) {
    super(permissionGrantRepository, guidGenerator, currentTenant);
  }

  override check(name: string, providerName: string, providerKey: string | undefined): Promise<PermissionValueProviderGrantInfo> {
    return this.currentTenant.run(undefined, undefined, () => super.check(name, providerName, providerKey));
  }

  override checkMany(names: readonly string[], providerName: string, providerKey: string | undefined): Promise<MultiplePermissionValueProviderGrantInfo> {
    return this.currentTenant.run(undefined, undefined, () => super.checkMany(names, providerName, providerKey));
  }

  override set(name: string, providerKey: string | undefined, isGranted: boolean): Promise<void> {
    return this.currentTenant.run(undefined, undefined, () => super.set(name, providerKey, isGranted));
  }

  protected override grant(name: string, providerKey: string | undefined): Promise<void> {
    return this.currentTenant.run(undefined, undefined, () => super.grant(name, providerKey));
  }

  protected override revoke(name: string, providerKey: string | undefined): Promise<void> {
    return this.currentTenant.run(undefined, undefined, () => super.revoke(name, providerKey));
  }
}
