import { createToken, type Guid } from "@abp/core";

/** Port of `UserFinderResult` (Volo.Abp.Identity.Domain.Shared). */
export interface UserFinderResult {
  id: Guid;
  userName: string;
}

/** Port of `RoleFinderResult` (Volo.Abp.Identity.Domain.Shared). */
export interface RoleFinderResult {
  id: Guid;
  roleName: string;
}

/**
 * Port of `IUserRoleFinder`. In .NET it is declared by `Volo.Abp.Identity.Domain.Shared` and consumed by
 * `Volo.Abp.PermissionManagement.Domain.Identity`; that bridge lives in this package (`domain/identity-providers`),
 * so the contract moved here and the identity module implements it (`@Transient(IUserRoleFinder)`).
 * The obsolete `GetRolesAsync` overload is not ported.
 */
export interface IUserRoleFinder {
  getRoleNames(userId: Guid): Promise<string[]>;
  searchUser(filter?: string, page?: number): Promise<UserFinderResult[]>;
  searchRole(filter?: string, page?: number): Promise<RoleFinderResult[]>;
  searchUserByIds(ids: readonly Guid[]): Promise<UserFinderResult[]>;
  searchRoleByNames(names: readonly string[]): Promise<RoleFinderResult[]>;
}
export const IUserRoleFinder = createToken<IUserRoleFinder>("IUserRoleFinder");
