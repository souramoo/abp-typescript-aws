import { AbpModule, DependsOn } from "@abp/core";
import { ClientPermissionValueProvider, RolePermissionValueProvider, UserPermissionValueProvider } from "@abp/authorization";
import { AbpUsersAbstractionModule } from "@abp/users/domain-shared";
import { AbpPermissionManagementDomainModule } from "../abp-permission-management-domain-module.js";
import { PermissionManagementOptions } from "../permission-management-options.js";
import { ClientPermissionManagementProvider } from "./client-permission-management-provider.js";
import { RolePermissionManagementProvider } from "./role-permission-management-provider.js";
import { UserPermissionManagementProvider } from "./user-permission-management-provider.js";
import "./user-deleted-event-handler.js";

/**
 * Port of `AbpPermissionManagementDomainIdentityModule` (`modules/identity/src/Volo.Abp.PermissionManagement.Domain.Identity`).
 * It lives here so the identity module only has to implement `IUserRoleFinder`; the .NET dependency on
 * `AbpIdentityDomainSharedModule` is therefore not declared. The role deleted/renamed handlers stay with the identity module.
 */
@DependsOn(AbpPermissionManagementDomainModule, AbpUsersAbstractionModule)
export class AbpPermissionManagementDomainIdentityModule extends AbpModule {
  override configureServices(): void {
    this.configure(PermissionManagementOptions, (options) => {
      options.managementProviders.add(UserPermissionManagementProvider);
      options.managementProviders.add(RolePermissionManagementProvider);
      options.providerPolicies.set(UserPermissionValueProvider.ProviderName, "AbpIdentity.Users.ManagePermissions");
      options.providerPolicies.set(RolePermissionValueProvider.ProviderName, "AbpIdentity.Roles.ManagePermissions");
    });
  }
}

/**
 * Port of `AbpPermissionManagementDomainOpenIddictModule` (`modules/openiddict/src/Volo.Abp.PermissionManagement.Domain.OpenIddict`)
 * for the `C`lient provider; the application deleted / client id changed handlers stay with the auth module.
 */
@DependsOn(AbpPermissionManagementDomainModule)
export class AbpPermissionManagementDomainOpenIddictModule extends AbpModule {
  override configureServices(): void {
    this.configure(PermissionManagementOptions, (options) => {
      options.managementProviders.add(ClientPermissionManagementProvider);
      options.providerPolicies.set(ClientPermissionValueProvider.ProviderName, "OpenIddictPro.Application.ManagePermissions");
    });
  }
}
