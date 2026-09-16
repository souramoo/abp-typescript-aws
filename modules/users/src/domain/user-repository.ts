import { createToken, isNullOrWhiteSpace, keyedToken, type AbstractClass, type Guid, type ServiceToken } from "@abp/core";
import type { IBasicRepository } from "@abp/ddd-domain";
import type { IUser } from "./user.js";

/** Port of `IUserRepository<TUser>`. The `IEnumerable<Guid>` overload of `GetListAsync` is `getListByIds`. */
export interface IUserRepository<TUser extends IUser> extends IBasicRepository<TUser, Guid> {
  findByUserName(userName: string, signal?: AbortSignal): Promise<TUser | undefined>;
  getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<TUser[]>;
  search(sorting?: string, maxResultCount?: number, skipCount?: number, filter?: string, signal?: AbortSignal): Promise<TUser[]>;
  /** Port of `GetCountAsync(filter)`; the base repository's `getCount(signal)` form stays valid (the first argument may be the signal). */
  getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number>;
}

const IUserRepositoryBase = createToken<unknown>("IUserRepository");

/** The token of `IUserRepository<TUser>` for a user class (stable per class); modules usually declare their own narrower token. */
export function userRepositoryToken<TUser extends IUser>(userType: AbstractClass<TUser>): ServiceToken<IUserRepository<TUser>> {
  return keyedToken<IUserRepository<TUser>>(IUserRepositoryBase, userType);
}

/** The default `sorting` of user searches (`nameof(IUserData.UserName)`). */
export const DefaultUserSorting = "userName";

/** Port of the `WhereIf(!filter.IsNullOrWhiteSpace(), …)` filter shared by every user repository: user name, email, name or surname contains the filter. */
export function matchesUserSearchFilter(user: IUser, filter: string | undefined): boolean {
  if (isNullOrWhiteSpace(filter)) return true;
  return user.userName.includes(filter) || (user.email !== undefined && user.email.includes(filter)) || (user.name !== undefined && user.name.includes(filter)) || (user.surname !== undefined && user.surname.includes(filter));
}
