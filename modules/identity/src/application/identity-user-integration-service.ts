import { IntegrationService, Transient, type Guid } from "@abp/core";
import { ListResultDto } from "@abp/ddd-application";
import { disableTracking } from "@abp/ddd-domain";
import { RoleData, UserData } from "@abp/users/domain-shared";
import { IIdentityUserIntegrationService, type RoleLookupCountInputDto, type RoleLookupSearchInputDto, type UserLookupCountInputDto, type UserLookupSearchInputDto } from "../application-contracts/index.js";
import { IUserRoleFinder } from "../domain-shared/index.js";
import { IIdentityRoleRepository, IIdentityUserRepository, IdentityUserRepositoryExternalUserLookupServiceProvider, type IdentityRole } from "../domain/index.js";
import { IdentityAppServiceBase } from "./identity-app-service-base.js";

function toRoleData(role: IdentityRole): RoleData {
  return new RoleData({ id: role.id, name: role.name, isDefault: role.isDefault, isStatic: role.isStatic, isPublic: role.isPublic, tenantId: role.tenantId, extraProperties: role.extraProperties });
}

/** Port of `IdentityUserIntegrationService`. */
@Transient(IIdentityUserIntegrationService)
@IntegrationService()
export class IdentityUserIntegrationService extends IdentityAppServiceBase implements IIdentityUserIntegrationService {
  static readonly inject = [IUserRoleFinder, IdentityUserRepositoryExternalUserLookupServiceProvider, IIdentityUserRepository, IIdentityRoleRepository] as const;

  constructor(
    protected readonly userRoleFinder: IUserRoleFinder,
    protected readonly userLookupServiceProvider: IdentityUserRepositoryExternalUserLookupServiceProvider,
    protected readonly userRepository: IIdentityUserRepository,
    protected readonly roleRepository: IIdentityRoleRepository,
  ) {
    super();
  }

  async getRoleNames(id: Guid): Promise<string[]> {
    return this.userRoleFinder.getRoleNames(id);
  }

  async findById(id: Guid): Promise<UserData | undefined> {
    const userData = await this.userLookupServiceProvider.findById(id);
    return userData === undefined ? undefined : UserData.from(userData);
  }

  async findByUserName(userName: string): Promise<UserData | undefined> {
    const userData = await this.userLookupServiceProvider.findByUserName(userName);
    return userData === undefined ? undefined : UserData.from(userData);
  }

  async search(input: UserLookupSearchInputDto): Promise<ListResultDto<UserData>> {
    const users = await this.userLookupServiceProvider.search(input.sorting ?? undefined, input.filter ?? undefined, input.maxResultCount, input.skipCount);
    return new ListResultDto(users.map((u) => UserData.from(u)));
  }

  async searchByIds(ids: readonly Guid[]): Promise<ListResultDto<UserData>> {
    const users = await this.userRepository.getListByIds(ids);
    return new ListResultDto(
      users.map(
        (u) =>
          new UserData({
            id: u.id,
            userName: u.userName,
            email: u.email,
            name: u.name,
            surname: u.surname,
            emailConfirmed: u.emailConfirmed,
            phoneNumber: u.phoneNumber,
            phoneNumberConfirmed: u.phoneNumberConfirmed,
            tenantId: u.tenantId,
            isActive: u.isActive,
            extraProperties: u.extraProperties,
          }),
      ),
    );
  }

  async getCount(input: UserLookupCountInputDto): Promise<number> {
    return this.userLookupServiceProvider.getCount(input.filter ?? undefined);
  }

  async searchRole(input: RoleLookupSearchInputDto): Promise<ListResultDto<RoleData>> {
    using _tracking = disableTracking(this.roleRepository);
    const roles = await this.roleRepository.getList({ sorting: input.sorting ?? undefined, maxResultCount: input.maxResultCount, skipCount: input.skipCount, filter: input.filter ?? undefined });
    return new ListResultDto(roles.map(toRoleData));
  }

  async searchRoleByNames(names: readonly string[]): Promise<ListResultDto<RoleData>> {
    using _tracking = disableTracking(this.roleRepository);
    const roles = await this.roleRepository.getListByNames(names);
    return new ListResultDto(roles.map(toRoleData));
  }

  async getRoleCount(input: RoleLookupCountInputDto): Promise<number> {
    return this.roleRepository.getCount(input.filter ?? undefined);
  }
}
