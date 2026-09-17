import { Transient, type Guid } from "@abp/core";
import { IExternalUserLookupServiceProvider, type IUserData } from "@abp/users/domain-shared";
import { toAbpUserData } from "@abp/users/domain";
import { ILookupNormalizer } from "./identity-options.js";
import { IIdentityUserRepository } from "./repositories.js";

/**
 * Port of `IdentityUserRepositoryExternalUserLookupServiceProvider`: makes the identity users the user source of the
 * `@abp/users` lookup service (registered as `IExternalUserLookupServiceProvider`, like the .NET conventional registration).
 */
@Transient(IExternalUserLookupServiceProvider)
export class IdentityUserRepositoryExternalUserLookupServiceProvider implements IExternalUserLookupServiceProvider {
  static readonly inject = [IIdentityUserRepository, ILookupNormalizer] as const;

  constructor(
    protected readonly userRepository: IIdentityUserRepository,
    protected readonly lookupNormalizer: ILookupNormalizer,
  ) {}

  async findById(id: Guid, signal?: AbortSignal): Promise<IUserData | undefined> {
    const user = await this.userRepository.find(id, false, signal);
    return user === undefined ? undefined : toAbpUserData(user);
  }

  async findByUserName(userName: string, signal?: AbortSignal): Promise<IUserData | undefined> {
    const user = await this.userRepository.findByNormalizedUserName(this.lookupNormalizer.normalizeName(userName) ?? userName, false, signal);
    return user === undefined ? undefined : toAbpUserData(user);
  }

  async search(sorting?: string, filter?: string, maxResultCount = Number.MAX_SAFE_INTEGER, skipCount = 0, signal?: AbortSignal): Promise<IUserData[]> {
    const users = await this.userRepository.getList({ sorting, maxResultCount, skipCount, filter, includeDetails: false }, signal);
    return users.map(toAbpUserData);
  }

  async getCount(filter?: string, signal?: AbortSignal): Promise<number> {
    return this.userRepository.getCount({ filter }, signal);
  }
}
