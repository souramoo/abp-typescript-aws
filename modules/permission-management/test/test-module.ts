import { AbpModule, DependsOn, Transient, localizableString, type Guid, type ServiceConfigurationContext } from "@abp/core";
import { PermissionDefinitionProvider, RolePermissionValueProvider, type IPermissionDefinitionContext } from "@abp/authorization";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { AbpPermissionManagementResource, IUserRoleFinder, type RoleFinderResult, type UserFinderResult } from "../src/domain-shared/index.js";
import { AbpPermissionManagementDomainIdentityModule, AbpPermissionManagementDomainOpenIddictModule } from "../src/domain/index.js";
import { AbpPermissionManagementMemoryDbModule } from "../src/memory-db/index.js";

export const TestPermissions = {
  GroupName: "TestGroup",
  Users: "Test.Users",
  UsersCreate: "Test.Users.Create",
  RoleOnly: "Test.RoleOnly",
  HostOnly: "Test.HostOnly",
  Disabled: "Test.Disabled",
  ManageRolePermissions: "AbpIdentity.Roles.ManagePermissions",
  ManageUserPermissions: "AbpIdentity.Users.ManagePermissions",
} as const;

@Transient()
export class TestPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const group = context.addGroup(TestPermissions.GroupName, localizableString(AbpPermissionManagementResource, "Permissions"));
    group.addPermission(TestPermissions.Users, localizableString(AbpPermissionManagementResource, "Permissions")).addChild(TestPermissions.UsersCreate);
    group.addPermission(TestPermissions.RoleOnly).withProviders(RolePermissionValueProvider.ProviderName);
    group.addPermission(TestPermissions.HostOnly, undefined, MultiTenancySides.Host);
    group.addPermission(TestPermissions.Disabled, undefined, MultiTenancySides.Both, false);
    group.addPermission(TestPermissions.ManageRolePermissions);
    group.addPermission(TestPermissions.ManageUserPermissions);
  }
}

/** Stands in for the identity module's `IUserRoleFinder` implementation. */
export class FakeUserRoleFinder implements IUserRoleFinder {
  readonly roles = new Map<Guid, string[]>();

  async getRoleNames(userId: Guid): Promise<string[]> {
    return this.roles.get(userId) ?? [];
  }
  async searchUser(): Promise<UserFinderResult[]> {
    return [];
  }
  async searchRole(): Promise<RoleFinderResult[]> {
    return [];
  }
  async searchUserByIds(): Promise<UserFinderResult[]> {
    return [];
  }
  async searchRoleByNames(): Promise<RoleFinderResult[]> {
    return [];
  }
}

export const userRoleFinder = new FakeUserRoleFinder();

@DependsOn(AbpPermissionManagementMemoryDbModule, AbpPermissionManagementDomainIdentityModule, AbpPermissionManagementDomainOpenIddictModule)
export class PermissionManagementTestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addSingleton(IUserRoleFinder, { useValue: userRoleFinder });
  }
}
