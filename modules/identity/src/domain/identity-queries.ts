import { isNullOrWhiteSpace, type Guid } from "@abp/core";
import type { IQueryable } from "@abp/ddd-domain";
import type { IdentityClaimType } from "./identity-claim-type.js";
import type { IdentityLinkUser, IdentityLinkUserInfo } from "./identity-link-user.js";
import type { IdentityRole } from "./identity-role.js";
import type { IdentitySecurityLog } from "./identity-security-log.js";
import type { IdentitySession } from "./identity-session.js";
import { isUserLockedOut, type IdentityUser } from "./identity-user.js";
import type { IdentitySecurityLogFilterOptions, IdentitySessionFilterOptions, IdentityUserFilterOptions, PagedQueryOptions } from "./repositories.js";

/*
 * The `WhereIf(...)` chains of the MongoDB repositories as predicates, shared by the DynamoDB and memory-db
 * implementations (both evaluate them in memory over the tenant partition / collection).
 */

/** Port of the `filter`/named-column part of `MongoIdentityUserRepository.GetFilteredQueryableAsync` (the `roleId` part needs the OU ids, see {@link matchesIdentityUserRole}). */
export function matchesIdentityUserFilter(user: IdentityUser, options: IdentityUserFilterOptions, now: Date = new Date()): boolean {
  if (options.id !== undefined) return user.id === options.id;
  const filter = options.filter;
  if (!isNullOrWhiteSpace(filter)) {
    const upperFilter = filter.toUpperCase();
    const matches =
      user.normalizedUserName.includes(upperFilter) ||
      user.normalizedEmail.includes(upperFilter) ||
      (user.name !== undefined && user.name.includes(filter)) ||
      (user.surname !== undefined && user.surname.includes(filter)) ||
      (user.phoneNumber !== undefined && user.phoneNumber.includes(filter));
    if (!matches) return false;
  }
  if (options.organizationUnitId !== undefined && !user.organizationUnits.some((x) => x.organizationUnitId === options.organizationUnitId)) return false;
  if (!isNullOrWhiteSpace(options.userName) && user.userName !== options.userName) return false;
  if (!isNullOrWhiteSpace(options.phoneNumber) && user.phoneNumber !== options.phoneNumber) return false;
  if (!isNullOrWhiteSpace(options.emailAddress) && user.email !== options.emailAddress) return false;
  if (!isNullOrWhiteSpace(options.name) && user.name !== options.name) return false;
  if (!isNullOrWhiteSpace(options.surname) && user.surname !== options.surname) return false;
  if (options.isLockedOut !== undefined && isUserLockedOut(user, now) !== options.isLockedOut) return false;
  if (options.notActive !== undefined && user.isActive !== !options.notActive) return false;
  if (options.emailConfirmed !== undefined && user.emailConfirmed !== options.emailConfirmed) return false;
  if (options.isExternal !== undefined && user.isExternal !== options.isExternal) return false;
  if (options.maxCreationTime !== undefined && !(user.creationTime <= options.maxCreationTime)) return false;
  if (options.minCreationTime !== undefined && !(user.creationTime >= options.minCreationTime)) return false;
  if (options.maxModifitionTime !== undefined && !(user.lastModificationTime !== undefined && user.lastModificationTime <= options.maxModifitionTime)) return false;
  if (options.minModifitionTime !== undefined && !(user.lastModificationTime !== undefined && user.lastModificationTime >= options.minModifitionTime)) return false;
  return true;
}

/** The `roleId` part of the user filter: the user holds the role directly or through one of `organizationUnitIdsWithRole`. */
export function matchesIdentityUserRole(user: IdentityUser, roleId: Guid, organizationUnitIdsWithRole: ReadonlySet<Guid>): boolean {
  return user.roles.some((r) => r.roleId === roleId) || user.organizationUnits.some((ou) => organizationUnitIdsWithRole.has(ou.organizationUnitId));
}

/** Port of the member filter of `MongoOrganizationUnitRepository` (user name, email or phone number contains the filter). */
export function matchesOrganizationUnitMemberFilter(user: IdentityUser, filter: string | undefined): boolean {
  if (isNullOrWhiteSpace(filter)) return true;
  return user.userName.includes(filter) || user.email.includes(filter) || (user.phoneNumber !== undefined && user.phoneNumber.includes(filter));
}

/** Port of the role filter (`Name.Contains(filter) || NormalizedName.Contains(filter)`). */
export function matchesIdentityRoleFilter(role: IdentityRole, filter: string | undefined): boolean {
  if (isNullOrWhiteSpace(filter)) return true;
  return role.name.includes(filter) || role.normalizedName.includes(filter);
}

export function matchesIdentityClaimTypeFilter(claimType: IdentityClaimType, filter: string | undefined): boolean {
  return isNullOrWhiteSpace(filter) || claimType.name.includes(filter);
}

/** Port of `MongoIdentitySecurityLogRepository.GetListQueryAsync`. */
export function matchesIdentitySecurityLogFilter(log: IdentitySecurityLog, options: IdentitySecurityLogFilterOptions): boolean {
  if (options.startTime !== undefined && !(log.creationTime >= options.startTime)) return false;
  if (options.endTime !== undefined) {
    const endExclusive = new Date(Date.UTC(options.endTime.getUTCFullYear(), options.endTime.getUTCMonth(), options.endTime.getUTCDate() + 1));
    if (!(log.creationTime < endExclusive)) return false;
  }
  if (!isNullOrWhiteSpace(options.applicationName) && log.applicationName !== options.applicationName) return false;
  if (!isNullOrWhiteSpace(options.identity) && log.identity !== options.identity) return false;
  if (!isNullOrWhiteSpace(options.action) && log.action !== options.action) return false;
  if (options.userId !== undefined && log.userId !== options.userId) return false;
  if (!isNullOrWhiteSpace(options.userName) && log.userName !== options.userName) return false;
  if (!isNullOrWhiteSpace(options.clientId) && log.clientId !== options.clientId) return false;
  if (!isNullOrWhiteSpace(options.correlationId) && log.correlationId !== options.correlationId) return false;
  if (!isNullOrWhiteSpace(options.clientIpAddress) && log.clientIpAddress !== options.clientIpAddress) return false;
  return true;
}

export function matchesIdentitySessionFilter(session: IdentitySession, options: IdentitySessionFilterOptions): boolean {
  if (options.userId !== undefined && session.userId !== options.userId) return false;
  if (!isNullOrWhiteSpace(options.device) && session.device !== options.device) return false;
  if (!isNullOrWhiteSpace(options.clientId) && session.clientId !== options.clientId) return false;
  return true;
}

/** Port of the `GetListAsync(linkUserInfo, excludes)` predicate of `MongoIdentityLinkUserRepository`. */
export function matchesLinkUser(link: IdentityLinkUser, linkUserInfo: IdentityLinkUserInfo, excludes: readonly IdentityLinkUserInfo[] = []): boolean {
  if (!link.involves(linkUserInfo)) return false;
  return !excludes.some((userInfo) => link.source.equals(userInfo) || link.target.equals(userInfo));
}

/** Applies `sorting` (or the default) and the page of the .NET list methods (`OrderBy(sorting).PageBy(skip, max)`). */
export function applyPagedQuery<T>(query: IQueryable<T>, options: PagedQueryOptions | undefined, defaultSorting: string): IQueryable<T> {
  const sorting = options === undefined || isNullOrWhiteSpace(options.sorting) ? defaultSorting : options.sorting;
  return query.orderBySorting(sorting).skip(options?.skipCount ?? 0).take(options?.maxResultCount ?? Number.MAX_SAFE_INTEGER);
}
