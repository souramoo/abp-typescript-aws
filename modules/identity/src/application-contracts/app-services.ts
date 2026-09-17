import { createToken, type Guid } from "@abp/core";
import type { IApplicationService, ICrudAppService, ListResultDto } from "@abp/ddd-application";
import type { RoleData, UserData } from "@abp/users/domain-shared";
import type {
  GetIdentityRolesInput,
  GetIdentityUsersInput,
  IdentityRoleCreateDto,
  IdentityRoleDto,
  IdentityRoleUpdateDto,
  IdentityUserCreateDto,
  IdentityUserDto,
  IdentityUserUpdateDto,
  IdentityUserUpdateRolesDto,
  RoleLookupCountInputDto,
  RoleLookupSearchInputDto,
  UserLookupCountInputDto,
  UserLookupSearchInputDto,
} from "./dtos.js";

/** Port of `IdentityRemoteServiceConsts`. */
export const IdentityRemoteServiceConsts = {
  RemoteServiceName: "AbpIdentity",
  ModuleName: "identity",
} as const;

/** Port of `IIdentityUserAppService`. */
export interface IIdentityUserAppService extends ICrudAppService<IdentityUserDto, Guid, GetIdentityUsersInput, IdentityUserCreateDto, IdentityUserUpdateDto> {
  getRoles(id: Guid): Promise<ListResultDto<IdentityRoleDto>>;
  getAssignableRoles(): Promise<ListResultDto<IdentityRoleDto>>;
  updateRoles(id: Guid, input: IdentityUserUpdateRolesDto): Promise<void>;
  findByUsername(userName: string): Promise<IdentityUserDto | undefined>;
  findByEmail(email: string): Promise<IdentityUserDto | undefined>;
  findById(id: Guid): Promise<IdentityUserDto | undefined>;
}
export const IIdentityUserAppService = createToken<IIdentityUserAppService>("IIdentityUserAppService");

/** Port of `IIdentityRoleAppService`. */
export interface IIdentityRoleAppService extends ICrudAppService<IdentityRoleDto, Guid, GetIdentityRolesInput, IdentityRoleCreateDto, IdentityRoleUpdateDto> {
  getAllList(): Promise<ListResultDto<IdentityRoleDto>>;
}
export const IIdentityRoleAppService = createToken<IIdentityRoleAppService>("IIdentityRoleAppService");

/** Port of `IIdentityUserLookupAppService` (obsolete in .NET in favour of `IIdentityUserIntegrationService`, kept for the HTTP API). */
export interface IIdentityUserLookupAppService extends IApplicationService {
  findById(id: Guid): Promise<UserData | undefined>;
  findByUserName(userName: string): Promise<UserData | undefined>;
  search(input: UserLookupSearchInputDto): Promise<ListResultDto<UserData>>;
  getCount(input: UserLookupCountInputDto): Promise<number>;
}
export const IIdentityUserLookupAppService = createToken<IIdentityUserLookupAppService>("IIdentityUserLookupAppService");

/** Port of `IIdentityUserIntegrationService` (`[IntegrationService]`). */
export interface IIdentityUserIntegrationService extends IApplicationService {
  getRoleNames(id: Guid): Promise<string[]>;
  findById(id: Guid): Promise<UserData | undefined>;
  findByUserName(userName: string): Promise<UserData | undefined>;
  search(input: UserLookupSearchInputDto): Promise<ListResultDto<UserData>>;
  searchByIds(ids: readonly Guid[]): Promise<ListResultDto<UserData>>;
  getCount(input: UserLookupCountInputDto): Promise<number>;
  searchRole(input: RoleLookupSearchInputDto): Promise<ListResultDto<RoleData>>;
  searchRoleByNames(names: readonly string[]): Promise<ListResultDto<RoleData>>;
  getRoleCount(input: RoleLookupCountInputDto): Promise<number>;
}
export const IIdentityUserIntegrationService = createToken<IIdentityUserIntegrationService>("IIdentityUserIntegrationService");
