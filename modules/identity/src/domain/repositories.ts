import { createToken, type Guid } from "@abp/core";
import type { IBasicRepository } from "@abp/ddd-domain";
import type { Claim } from "@abp/security";
import type { IdentityClaimType } from "./identity-claim-type.js";
import type { IdentityLinkUser, IdentityLinkUserInfo } from "./identity-link-user.js";
import type { IdentityRole, IdentityRoleWithUserCount, IdentityUserIdWithRoleNames } from "./identity-role.js";
import type { IdentitySecurityLog } from "./identity-security-log.js";
import type { IdentitySession } from "./identity-session.js";
import type { IdentityUserDelegation } from "./identity-user-delegation.js";
import type { IdentityUser } from "./identity-user.js";
import type { OrganizationUnit } from "./organization-unit.js";

/** The `sorting`/`maxResultCount`/`skipCount` triple of the .NET list methods. */
export interface PagedQueryOptions {
  sorting?: string;
  maxResultCount?: number;
  skipCount?: number;
}

/** The named filter arguments of `IIdentityUserRepository.GetListAsync`/`GetCountAsync`. */
export interface IdentityUserFilterOptions {
  filter?: string;
  roleId?: Guid;
  organizationUnitId?: Guid;
  id?: Guid;
  userName?: string;
  phoneNumber?: string;
  emailAddress?: string;
  name?: string;
  surname?: string;
  isLockedOut?: boolean;
  notActive?: boolean;
  emailConfirmed?: boolean;
  isExternal?: boolean;
  maxCreationTime?: Date;
  minCreationTime?: Date;
  maxModifitionTime?: Date;
  minModifitionTime?: Date;
}

export interface IdentityUserListOptions extends PagedQueryOptions, IdentityUserFilterOptions {
  includeDetails?: boolean;
}

/**
 * Port of `IIdentityUserRepository`. The optional positional arguments of the .NET methods are options objects;
 * `GetRoleNamesAsync(IEnumerable<Guid>)` is `getRoleNamesOfUsers`, the `Guid? tenantId` overloads of
 * `FindByNormalizedUserName/Email` are `findByTenantIdAndNormalizedUserName/Email`. Passkey members are not ported.
 */
export interface IIdentityUserRepository extends IBasicRepository<IdentityUser, Guid> {
  findByNormalizedUserName(normalizedUserName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser | undefined>;
  getRoleNames(id: Guid, signal?: AbortSignal): Promise<string[]>;
  getRoleNamesInOrganizationUnit(id: Guid, signal?: AbortSignal): Promise<string[]>;
  findByLogin(loginProvider: string, providerKey: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser | undefined>;
  findByNormalizedEmail(normalizedEmail: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser | undefined>;
  getListByClaim(claim: Claim, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  removeClaimFromAllUsers(claimType: string, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  getListByNormalizedRoleName(normalizedRoleName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUserIdListByRoleId(roleId: Guid, signal?: AbortSignal): Promise<Guid[]>;
  /** Port of `GetListAsync(sorting, maxResultCount, skipCount, filter, includeDetails, roleId, …)`; the base repository's `getList(includeDetails?)` stays valid. */
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  getList(options: IdentityUserListOptions, signal?: AbortSignal): Promise<IdentityUser[]>;
  getRoles(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityRole[]>;
  getOrganizationUnits(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getUsersInOrganizationUnit(organizationUnitId: Guid, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUsersInOrganizationsList(organizationUnitIds: readonly Guid[], signal?: AbortSignal): Promise<IdentityUser[]>;
  getUsersInOrganizationUnitWithChildren(code: string, signal?: AbortSignal): Promise<IdentityUser[]>;
  /** Port of `GetCountAsync(filter, roleId, …)`; the base repository's `getCount(signal)` form stays valid. */
  getCount(optionsOrSignal?: IdentityUserFilterOptions | AbortSignal, signal?: AbortSignal): Promise<number>;
  findByTenantIdAndUserName(userName: string, tenantId: Guid | undefined, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser | undefined>;
  getListByIds(ids: Iterable<Guid>, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  updateRole(sourceRoleId: Guid, targetRoleId: Guid | undefined, signal?: AbortSignal): Promise<void>;
  updateOrganization(sourceOrganizationId: Guid, targetOrganizationId: Guid | undefined, signal?: AbortSignal): Promise<void>;
  getRoleNamesOfUsers(userIds: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityUserIdWithRoleNames[]>;
  getUsersByNormalizedUserName(normalizedUserName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUsersByNormalizedUserNames(normalizedUserNames: readonly string[], includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUsersByNormalizedEmail(normalizedEmail: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUsersByNormalizedEmails(normalizedEmails: readonly string[], includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUsersByLogin(loginProvider: string, providerKey: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser[]>;
  findByTenantIdAndNormalizedUserName(tenantId: Guid | undefined, normalizedUserName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser | undefined>;
  findByTenantIdAndNormalizedEmail(tenantId: Guid | undefined, normalizedEmail: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityUser | undefined>;
}
export const IIdentityUserRepository = createToken<IIdentityUserRepository>("IIdentityUserRepository");

export interface IdentityRoleListOptions extends PagedQueryOptions {
  filter?: string;
  includeDetails?: boolean;
}

/** Port of `IIdentityRoleRepository` (`GetListAsync(ids)` → `getListByIds`, `GetListAsync(names)` → `getListByNames`). */
export interface IIdentityRoleRepository extends IBasicRepository<IdentityRole, Guid> {
  findByNormalizedName(normalizedRoleName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityRole | undefined>;
  getListWithUserCount(options?: IdentityRoleListOptions, signal?: AbortSignal): Promise<IdentityRoleWithUserCount[]>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityRole[]>;
  getList(options: IdentityRoleListOptions, signal?: AbortSignal): Promise<IdentityRole[]>;
  getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityRole[]>;
  getListByNames(names: Iterable<string>, signal?: AbortSignal): Promise<IdentityRole[]>;
  getDefaultOnes(includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityRole[]>;
  /** Port of `GetCountAsync(filter)`; the base repository's `getCount(signal)` form stays valid. */
  getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number>;
  removeClaimFromAllRoles(claimType: string, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
}
export const IIdentityRoleRepository = createToken<IIdentityRoleRepository>("IIdentityRoleRepository");

/** Port of `IIdentityClaimTypeRepository`. */
export interface IIdentityClaimTypeRepository extends IBasicRepository<IdentityClaimType, Guid> {
  /** Port of `AnyAsync(name, ignoredId)`: is there a claim type named `name` other than `ignoredId`? */
  anyByName(name: string, ignoredId?: Guid, signal?: AbortSignal): Promise<boolean>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<IdentityClaimType[]>;
  getList(options: PagedQueryOptions & { filter?: string }, signal?: AbortSignal): Promise<IdentityClaimType[]>;
  getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number>;
  getListByNames(names: Iterable<string>, signal?: AbortSignal): Promise<IdentityClaimType[]>;
}
export const IIdentityClaimTypeRepository = createToken<IIdentityClaimTypeRepository>("IIdentityClaimTypeRepository");

export interface OrganizationUnitMemberOptions extends PagedQueryOptions {
  filter?: string;
  includeChildren?: boolean;
  includeDetails?: boolean;
}

/** Port of `IOrganizationUnitRepository` (`GetAsync(displayName)` → `getByDisplayName`, `GetListAsync(ids)` → `getListByIds`). */
export interface IOrganizationUnitRepository extends IBasicRepository<OrganizationUnit, Guid> {
  getChildren(parentId: Guid | undefined, includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getAllChildrenWithParentCode(code: string, parentId: Guid | undefined, includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getByDisplayName(displayName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit | undefined>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getList(options: PagedQueryOptions & { includeDetails?: boolean }, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getListByIds(ids: Iterable<Guid>, includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getListByRoleId(roleId: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getListByDisplayNames(displayNames: readonly string[], includeDetails?: boolean, signal?: AbortSignal): Promise<OrganizationUnit[]>;
  getRoles(organizationUnit: OrganizationUnit, options?: PagedQueryOptions, signal?: AbortSignal): Promise<IdentityRole[]>;
  getRolesOfUnits(organizationUnitIds: readonly Guid[], options?: PagedQueryOptions, signal?: AbortSignal): Promise<IdentityRole[]>;
  getRolesCount(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<number>;
  getUnaddedRoles(organizationUnit: OrganizationUnit, options?: PagedQueryOptions & { filter?: string }, signal?: AbortSignal): Promise<IdentityRole[]>;
  getUnaddedRolesCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number>;
  getMembers(organizationUnit: OrganizationUnit, options?: OrganizationUnitMemberOptions, signal?: AbortSignal): Promise<IdentityUser[]>;
  getMemberIds(id: Guid, includeChildren?: boolean, signal?: AbortSignal): Promise<Guid[]>;
  getMembersCount(organizationUnit: OrganizationUnit, filter?: string, includeChildren?: boolean, signal?: AbortSignal): Promise<number>;
  getUnaddedUsers(organizationUnit: OrganizationUnit, options?: PagedQueryOptions & { filter?: string }, signal?: AbortSignal): Promise<IdentityUser[]>;
  getUnaddedUsersCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number>;
  removeAllRoles(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<void>;
  removeAllMembers(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<void>;
}
export const IOrganizationUnitRepository = createToken<IOrganizationUnitRepository>("IOrganizationUnitRepository");

export interface IdentitySecurityLogFilterOptions {
  startTime?: Date;
  endTime?: Date;
  applicationName?: string;
  identity?: string;
  action?: string;
  userId?: Guid;
  userName?: string;
  clientId?: string;
  correlationId?: string;
  clientIpAddress?: string;
}

/** Port of `IIdentitySecurityLogRepository`. */
export interface IIdentitySecurityLogRepository extends IBasicRepository<IdentitySecurityLog, Guid> {
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<IdentitySecurityLog[]>;
  getList(options: PagedQueryOptions & IdentitySecurityLogFilterOptions & { includeDetails?: boolean }, signal?: AbortSignal): Promise<IdentitySecurityLog[]>;
  getCount(optionsOrSignal?: IdentitySecurityLogFilterOptions | AbortSignal, signal?: AbortSignal): Promise<number>;
  getByUserId(id: Guid, userId: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<IdentitySecurityLog | undefined>;
}
export const IIdentitySecurityLogRepository = createToken<IIdentitySecurityLogRepository>("IIdentitySecurityLogRepository");

export interface IdentitySessionFilterOptions {
  userId?: Guid;
  device?: string;
  clientId?: string;
}

/** Port of `IIdentitySessionRepository` (`FindAsync(sessionId)` → `findBySessionId`, `ExistAsync` → `exists`/`existsBySessionId`). */
export interface IIdentitySessionRepository extends IBasicRepository<IdentitySession, Guid> {
  findBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession | undefined>;
  getBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession>;
  exists(id: Guid, signal?: AbortSignal): Promise<boolean>;
  existsBySessionId(sessionId: string, signal?: AbortSignal): Promise<boolean>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<IdentitySession[]>;
  getList(options: PagedQueryOptions & IdentitySessionFilterOptions, signal?: AbortSignal): Promise<IdentitySession[]>;
  getCount(optionsOrSignal?: IdentitySessionFilterOptions | AbortSignal, signal?: AbortSignal): Promise<number>;
  deleteAllOfUser(userId: Guid, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void>;
  deleteAllOfUserDevice(userId: Guid, device: string, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void>;
  /** Port of `DeleteAllAsync(TimeSpan inactiveTimeSpan)` (milliseconds). */
  deleteAllInactive(inactiveTimeSpanMs: number, signal?: AbortSignal): Promise<void>;
}
export const IIdentitySessionRepository = createToken<IIdentitySessionRepository>("IIdentitySessionRepository");

/** Port of `IIdentityLinkUserRepository` (`GetListAsync(batchSize)` → `getAllInBatches`, `DeleteAsync(info)` → `deleteAllOf`). */
export interface IIdentityLinkUserRepository extends IBasicRepository<IdentityLinkUser, Guid> {
  findLink(sourceLinkUserInfo: IdentityLinkUserInfo, targetLinkUserInfo: IdentityLinkUserInfo, signal?: AbortSignal): Promise<IdentityLinkUser | undefined>;
  getListOf(linkUserInfo: IdentityLinkUserInfo, excludes?: readonly IdentityLinkUserInfo[], signal?: AbortSignal): Promise<IdentityLinkUser[]>;
  getAllInBatches(batchSize: number, signal?: AbortSignal): Promise<IdentityLinkUser[]>;
  deleteAllOf(linkUserInfo: IdentityLinkUserInfo, signal?: AbortSignal): Promise<void>;
}
export const IIdentityLinkUserRepository = createToken<IIdentityLinkUserRepository>("IIdentityLinkUserRepository");

/** Port of `IIdentityUserDelegationRepository` (`GetListAsync(sourceUserId, targetUserId)` → `getListOf`). */
export interface IIdentityUserDelegationRepository extends IBasicRepository<IdentityUserDelegation, Guid> {
  getListOf(sourceUserId: Guid | undefined, targetUserId: Guid | undefined, signal?: AbortSignal): Promise<IdentityUserDelegation[]>;
  getActiveDelegations(targetUserId: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation[]>;
  findActiveDelegationById(id: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation | undefined>;
}
export const IIdentityUserDelegationRepository = createToken<IIdentityUserDelegationRepository>("IIdentityUserDelegationRepository");
