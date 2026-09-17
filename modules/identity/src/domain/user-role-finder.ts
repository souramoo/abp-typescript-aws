import { Transient, type Guid } from "@abp/core";
import { disableTracking } from "@abp/ddd-domain";
import { IUserRoleFinder, type RoleFinderResult, type UserFinderResult } from "../domain-shared/index.js";
import { IIdentityRoleRepository, IIdentityUserRepository } from "./repositories.js";

/** Port of `UserRoleFinder`: the identity module's implementation of the permission-management bridge. */
@Transient(IUserRoleFinder)
export class UserRoleFinder implements IUserRoleFinder {
  static readonly inject = [IIdentityUserRepository, IIdentityRoleRepository] as const;

  constructor(
    protected readonly identityUserRepository: IIdentityUserRepository,
    protected readonly identityRoleRepository: IIdentityRoleRepository,
  ) {}

  async getRoleNames(userId: Guid): Promise<string[]> {
    return this.identityUserRepository.getRoleNames(userId);
  }

  async searchUser(filter?: string, page = 1): Promise<UserFinderResult[]> {
    using _tracking = disableTracking(this.identityUserRepository);
    const pageNumber = page < 1 ? 1 : page;
    const users = await this.identityUserRepository.getList({ filter, skipCount: (pageNumber - 1) * 10, maxResultCount: 10 });
    return users.map((x) => ({ id: x.id, userName: x.userName }));
  }

  async searchRole(filter?: string, page = 1): Promise<RoleFinderResult[]> {
    using _tracking = disableTracking(this.identityUserRepository);
    const pageNumber = page < 1 ? 1 : page;
    const roles = await this.identityRoleRepository.getList({ filter, skipCount: (pageNumber - 1) * 10, maxResultCount: 10 });
    return roles.map((x) => ({ id: x.id, roleName: x.name }));
  }

  async searchUserByIds(ids: readonly Guid[]): Promise<UserFinderResult[]> {
    using _tracking = disableTracking(this.identityUserRepository);
    const users = await this.identityUserRepository.getListByIds(ids);
    return users.map((x) => ({ id: x.id, userName: x.userName }));
  }

  async searchRoleByNames(names: readonly string[]): Promise<RoleFinderResult[]> {
    using _tracking = disableTracking(this.identityUserRepository);
    const roles = await this.identityRoleRepository.getListByNames(names);
    return roles.map((x) => ({ id: x.id, roleName: x.name }));
  }
}
