import { isNullOrWhiteSpace, type Guid } from "@abp/core";
import { EntityNotFoundException, keysEqual, type IQueryable } from "@abp/ddd-domain";
import type { Claim } from "@abp/security";
import type { IdentityClaimType } from "./identity-claim-type.js";
import type { IdentityLinkUser, IdentityLinkUserInfo } from "./identity-link-user.js";
import { applyPagedQuery, matchesIdentityClaimTypeFilter, matchesIdentityRoleFilter, matchesIdentitySecurityLogFilter, matchesIdentitySessionFilter, matchesIdentityUserFilter, matchesIdentityUserRole, matchesLinkUser, matchesOrganizationUnitMemberFilter } from "./identity-queries.js";
import { IdentityRoleWithUserCount, type IdentityRole, type IdentityUserIdWithRoleNames } from "./identity-role.js";
import type { IdentitySecurityLog } from "./identity-security-log.js";
import { IdentitySession } from "./identity-session.js";
import type { IdentityUserDelegation } from "./identity-user-delegation.js";
import type { IdentityUser } from "./identity-user.js";
import { OrganizationUnit } from "./organization-unit.js";
import type { IdentityRoleListOptions, IdentitySecurityLogFilterOptions, IdentitySessionFilterOptions, IdentityUserFilterOptions, IdentityUserListOptions, OrganizationUnitMemberOptions, PagedQueryOptions } from "./repositories.js";

/** A data-filtered query over an entity (what `GetQueryableAsync<TOtherEntity>()` gives the MongoDB repositories). */
export type QueryableSource<T> = (signal?: AbortSignal) => Promise<IQueryable<T>>;

/** The write side of another entity a query needs (`UpdateManyAsync` on users, `DeleteAsync(predicate)` on sessions). */
export interface EntityWriter<T> {
  update(entity: T, autoSave?: boolean, signal?: AbortSignal): Promise<T>;
  updateMany(entities: Iterable<T>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  deleteMany(entities: Iterable<T>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
}

const DefaultUserSorting = "creationTime desc";
const DefaultRoleSorting = "creationTime desc";

/**
 * The query members of `IIdentityUserRepository` implemented once over `IQueryable`s (port of the query bodies of
 * `MongoIdentityUserRepository`); the DynamoDB and memory-db repositories delegate to it.
 */
export class IdentityUserRepositoryQueries {
  constructor(
    private readonly users: QueryableSource<IdentityUser>,
    private readonly roles: QueryableSource<IdentityRole>,
    private readonly organizationUnits: QueryableSource<OrganizationUnit>,
    private readonly writer: EntityWriter<IdentityUser>,
    private readonly getUser: (id: Guid, signal?: AbortSignal) => Promise<IdentityUser>,
  ) {}

  async findByNormalizedUserName(normalizedUserName: string, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.users(signal)).where((u) => u.normalizedUserName === normalizedUserName).orderBy("id").firstOrDefault(signal);
  }

  async findByNormalizedEmail(normalizedEmail: string, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.users(signal)).where((u) => u.normalizedEmail === normalizedEmail).orderBy("id").firstOrDefault(signal);
  }

  async findByLogin(loginProvider: string, providerKey: string, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.users(signal))
      .where((u) => u.logins.some((login) => login.loginProvider === loginProvider && login.providerKey === providerKey))
      .orderBy("id")
      .firstOrDefault(signal);
  }

  private async roleIdsOf(user: IdentityUser, signal?: AbortSignal): Promise<{ direct: Guid[]; all: Guid[]; organizationUnitRoleIds: Guid[] }> {
    const organizationUnitIds = new Set(user.organizationUnits.map((r) => r.organizationUnitId));
    const organizationUnits = organizationUnitIds.size === 0 ? [] : await (await this.organizationUnits(signal)).where((ou) => organizationUnitIds.has(ou.id)).toList(signal);
    const organizationUnitRoleIds = organizationUnits.flatMap((x) => x.roles.map((r) => r.roleId));
    const direct = user.roles.map((r) => r.roleId);
    return { direct, organizationUnitRoleIds, all: [...new Set([...organizationUnitRoleIds, ...direct])] };
  }

  async getRoleNames(id: Guid, signal?: AbortSignal): Promise<string[]> {
    const user = await this.getUser(id, signal);
    const { all } = await this.roleIdsOf(user, signal);
    if (all.length === 0) return [];
    const wanted = new Set(all);
    return (await (await this.roles(signal)).where((r) => wanted.has(r.id)).toList(signal)).map((r) => r.name);
  }

  async getRoleNamesInOrganizationUnit(id: Guid, signal?: AbortSignal): Promise<string[]> {
    const user = await this.getUser(id, signal);
    const { organizationUnitRoleIds } = await this.roleIdsOf(user, signal);
    if (organizationUnitRoleIds.length === 0) return [];
    const wanted = new Set(organizationUnitRoleIds);
    return (await (await this.roles(signal)).where((r) => wanted.has(r.id)).toList(signal)).map((r) => r.name);
  }

  async getRoles(id: Guid, signal?: AbortSignal): Promise<IdentityRole[]> {
    const user = await this.getUser(id, signal);
    const { all } = await this.roleIdsOf(user, signal);
    if (all.length === 0) return [];
    const wanted = new Set(all);
    return (await this.roles(signal)).where((r) => wanted.has(r.id)).toList(signal);
  }

  async getOrganizationUnits(id: Guid, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    const user = await this.getUser(id, signal);
    const wanted = new Set(user.organizationUnits.map((r) => r.organizationUnitId));
    if (wanted.size === 0) return [];
    return (await this.organizationUnits(signal)).where((ou) => wanted.has(ou.id)).toList(signal);
  }

  async getListByClaim(claim: Claim, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.users(signal)).where((u) => u.claims.some((c) => c.claimType === claim.type && (c.claimValue ?? "") === claim.value)).toList(signal);
  }

  async removeClaimFromAllUsers(claimType: string, autoSave = false, signal?: AbortSignal): Promise<void> {
    const users = await (await this.users(signal)).where((u) => u.claims.some((c) => c.claimType === claimType)).toList(signal);
    for (const user of users) user.claims = user.claims.filter((c) => c.claimType !== claimType);
    await this.writer.updateMany(users, autoSave, signal);
  }

  async getListByNormalizedRoleName(normalizedRoleName: string, signal?: AbortSignal): Promise<IdentityUser[]> {
    const role = await (await this.roles(signal)).where((x) => x.normalizedName === normalizedRoleName).orderBy("id").firstOrDefault(signal);
    if (!role) return [];
    return (await this.users(signal)).where((u) => u.roles.some((r) => r.roleId === role.id)).toList(signal);
  }

  async getUserIdListByRoleId(roleId: Guid, signal?: AbortSignal): Promise<Guid[]> {
    return (await (await this.users(signal)).where((u) => u.roles.some((r) => r.roleId === roleId)).toList(signal)).map((x) => x.id);
  }

  async getList(options: IdentityUserListOptions, signal?: AbortSignal): Promise<IdentityUser[]> {
    return applyPagedQuery(await this.filteredQuery(options, signal), options, DefaultUserSorting).toList(signal);
  }

  async getCount(options: IdentityUserFilterOptions, signal?: AbortSignal): Promise<number> {
    return (await this.filteredQuery(options, signal)).count(signal);
  }

  protected async filteredQuery(options: IdentityUserFilterOptions, signal?: AbortSignal): Promise<IQueryable<IdentityUser>> {
    let query = await this.users(signal);
    if (options.id !== undefined) return query.where((x) => x.id === options.id);
    if (options.roleId !== undefined) {
      const roleId = options.roleId;
      const organizationUnitIds = new Set((await (await this.organizationUnits(signal)).where((ou) => ou.roles.some((r) => r.roleId === roleId)).toList(signal)).map((ou) => ou.id));
      query = query.where((u) => matchesIdentityUserRole(u, roleId, organizationUnitIds));
    }
    const now = new Date();
    return query.where((u) => matchesIdentityUserFilter(u, options, now));
  }

  async getUsersInOrganizationUnit(organizationUnitId: Guid, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => uou.organizationUnitId === organizationUnitId)).toList(signal);
  }

  async getUsersInOrganizationsList(organizationUnitIds: readonly Guid[], signal?: AbortSignal): Promise<IdentityUser[]> {
    const wanted = new Set(organizationUnitIds);
    return (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => wanted.has(uou.organizationUnitId))).toList(signal);
  }

  async getUsersInOrganizationUnitWithChildren(code: string, signal?: AbortSignal): Promise<IdentityUser[]> {
    const organizationUnitIds = new Set((await (await this.organizationUnits(signal)).where((ou) => ou.code.startsWith(code)).toList(signal)).map((ou) => ou.id));
    return (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => organizationUnitIds.has(uou.organizationUnitId))).toList(signal);
  }

  async findByTenantIdAndUserName(userName: string, tenantId: Guid | undefined, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.users(signal)).where((u) => (u.tenantId ?? undefined) === (tenantId ?? undefined) && u.userName === userName).firstOrDefault(signal);
  }

  async getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityUser[]> {
    const idList = [...ids];
    if (idList.length === 0) return [];
    return (await this.users(signal)).where((x) => idList.some((id) => keysEqual(id, x.id))).toList(signal);
  }

  async updateRole(sourceRoleId: Guid, targetRoleId: Guid | undefined, signal?: AbortSignal): Promise<void> {
    const users = await (await this.users(signal)).where((x) => x.roles.some((r) => r.roleId === sourceRoleId)).toList(signal);
    for (const user of users) {
      user.removeRole(sourceRoleId);
      if (targetRoleId !== undefined) user.addRole(targetRoleId);
    }
    await this.writer.updateMany(users, false, signal);
  }

  async updateOrganization(sourceOrganizationId: Guid, targetOrganizationId: Guid | undefined, signal?: AbortSignal): Promise<void> {
    const sourceOrganizationUnit = await (await this.organizationUnits(signal)).where((x) => x.id === sourceOrganizationId).firstOrDefault(signal);
    if (!sourceOrganizationUnit) throw new EntityNotFoundException(OrganizationUnit, sourceOrganizationId);
    const allSourceOrganizationIds = (await (await this.organizationUnits(signal)).where((x) => x.code.startsWith(sourceOrganizationUnit.code)).toList(signal)).map((x) => x.id);
    const wanted = new Set(allSourceOrganizationIds);
    const users = await (await this.users(signal)).where((x) => x.organizationUnits.some((r) => wanted.has(r.organizationUnitId))).toList(signal);
    for (const user of users) {
      for (const organizationId of allSourceOrganizationIds) user.removeOrganizationUnit(organizationId);
      if (targetOrganizationId !== undefined) user.addOrganizationUnit(targetOrganizationId);
    }
    await this.writer.updateMany(users, false, signal);
  }

  async getRoleNamesOfUsers(userIds: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityUserIdWithRoleNames[]> {
    const users = await this.getListByIds(userIds, signal);
    const organizationUnitIds = new Set(users.flatMap((u) => u.organizationUnits.map((x) => x.organizationUnitId)));
    const organizationUnits = organizationUnitIds.size === 0 ? [] : await (await this.organizationUnits(signal)).where((ou) => organizationUnitIds.has(ou.id)).toList(signal);
    const allRoleIds = new Set([...users.flatMap((u) => u.roles.map((r) => r.roleId)), ...organizationUnits.flatMap((ou) => ou.roles.map((r) => r.roleId))]);
    const roles = allRoleIds.size === 0 ? [] : await (await this.roles(signal)).where((r) => allRoleIds.has(r.id)).toList(signal);
    const roleName = new Map(roles.map((r) => [r.id, r.name]));
    const result: IdentityUserIdWithRoleNames[] = [];
    for (const user of users) {
      const userOrganizationUnitIds = new Set(user.organizationUnits.map((x) => x.organizationUnitId));
      const organizationUnitRoleIds = organizationUnits.filter((ou) => userOrganizationUnitIds.has(ou.id)).flatMap((ou) => ou.roles.map((r) => r.roleId));
      const names = [...new Set([...user.roles.map((r) => r.roleId), ...organizationUnitRoleIds].map((id) => roleName.get(id)).filter((n): n is string => n !== undefined))];
      if (names.length > 0) result.push({ id: user.id, roleNames: names });
    }
    return result;
  }

  async getUsersByNormalizedUserName(normalizedUserName: string, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.users(signal)).where((u) => u.normalizedUserName === normalizedUserName).orderBy("id").toList(signal);
  }

  async getUsersByNormalizedUserNames(normalizedUserNames: readonly string[], signal?: AbortSignal): Promise<IdentityUser[]> {
    const wanted = new Set(normalizedUserNames);
    return (await this.users(signal)).where((u) => wanted.has(u.normalizedUserName)).orderBy("id").toList(signal);
  }

  async getUsersByNormalizedEmail(normalizedEmail: string, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.users(signal)).where((u) => u.normalizedEmail === normalizedEmail).orderBy("id").toList(signal);
  }

  async getUsersByNormalizedEmails(normalizedEmails: readonly string[], signal?: AbortSignal): Promise<IdentityUser[]> {
    const wanted = new Set(normalizedEmails);
    return (await this.users(signal)).where((u) => wanted.has(u.normalizedEmail)).orderBy("id").toList(signal);
  }

  async getUsersByLogin(loginProvider: string, providerKey: string, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.users(signal))
      .where((u) => u.logins.some((login) => login.loginProvider === loginProvider && login.providerKey === providerKey))
      .orderBy("id")
      .toList(signal);
  }

  async findByTenantIdAndNormalizedUserName(tenantId: Guid | undefined, normalizedUserName: string, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.users(signal)).where((u) => (u.tenantId ?? undefined) === (tenantId ?? undefined) && u.normalizedUserName === normalizedUserName).orderBy("id").firstOrDefault(signal);
  }

  async findByTenantIdAndNormalizedEmail(tenantId: Guid | undefined, normalizedEmail: string, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.users(signal)).where((u) => (u.tenantId ?? undefined) === (tenantId ?? undefined) && u.normalizedEmail === normalizedEmail).orderBy("id").firstOrDefault(signal);
  }
}

/** The query members of `IIdentityRoleRepository` (port of `MongoIdentityRoleRepository`). */
export class IdentityRoleRepositoryQueries {
  constructor(
    private readonly roles: QueryableSource<IdentityRole>,
    private readonly users: QueryableSource<IdentityUser>,
    private readonly writer: EntityWriter<IdentityRole>,
  ) {}

  async findByNormalizedName(normalizedRoleName: string, signal?: AbortSignal): Promise<IdentityRole | undefined> {
    return (await this.roles(signal)).where((r) => r.normalizedName === normalizedRoleName).orderBy("id").firstOrDefault(signal);
  }

  async getListWithUserCount(options: IdentityRoleListOptions = {}, signal?: AbortSignal): Promise<IdentityRoleWithUserCount[]> {
    const roles = await this.getList(options, signal);
    const roleIds = new Set(roles.map((x) => x.id));
    const users = roleIds.size === 0 ? [] : await (await this.users(signal)).where((user) => user.roles.some((role) => roleIds.has(role.roleId))).toList(signal);
    const counts = new Map<Guid, number>();
    for (const userRole of users.flatMap((user) => user.roles)) counts.set(userRole.roleId, (counts.get(userRole.roleId) ?? 0) + 1);
    return roles.map((role) => new IdentityRoleWithUserCount(role, counts.get(role.id) ?? 0));
  }

  async getList(options: IdentityRoleListOptions = {}, signal?: AbortSignal): Promise<IdentityRole[]> {
    const filter = options.filter;
    return applyPagedQuery((await this.roles(signal)).where((x) => matchesIdentityRoleFilter(x, filter)), options, DefaultRoleSorting).toList(signal);
  }

  async getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityRole[]> {
    const wanted = new Set(ids);
    if (wanted.size === 0) return [];
    return (await this.roles(signal)).where((t) => wanted.has(t.id)).toList(signal);
  }

  async getListByNames(names: Iterable<string>, signal?: AbortSignal): Promise<IdentityRole[]> {
    const wanted = new Set(names);
    if (wanted.size === 0) return [];
    return (await this.roles(signal)).where((x) => wanted.has(x.name)).toList(signal);
  }

  async getDefaultOnes(signal?: AbortSignal): Promise<IdentityRole[]> {
    return (await this.roles(signal)).where((r) => r.isDefault).toList(signal);
  }

  async getCount(filter: string | undefined, signal?: AbortSignal): Promise<number> {
    return (await this.roles(signal)).where((x) => matchesIdentityRoleFilter(x, filter)).count(signal);
  }

  async removeClaimFromAllRoles(claimType: string, autoSave = false, signal?: AbortSignal): Promise<void> {
    const roles = await (await this.roles(signal)).where((r) => r.claims.some((c) => c.claimType === claimType)).toList(signal);
    for (const role of roles) role.claims = role.claims.filter((c) => c.claimType !== claimType);
    await this.writer.updateMany(roles, autoSave, signal);
  }
}

/** The query members of `IOrganizationUnitRepository` (port of `MongoOrganizationUnitRepository`). */
export class OrganizationUnitRepositoryQueries {
  constructor(
    private readonly organizationUnits: QueryableSource<OrganizationUnit>,
    private readonly roles: QueryableSource<IdentityRole>,
    private readonly users: QueryableSource<IdentityUser>,
    private readonly userWriter: EntityWriter<IdentityUser>,
  ) {}

  async getChildren(parentId: Guid | undefined, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return (await this.organizationUnits(signal)).where((ou) => (ou.parentId ?? undefined) === (parentId ?? undefined)).toList(signal);
  }

  async getAllChildrenWithParentCode(code: string, parentId: Guid | undefined, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return (await this.organizationUnits(signal)).where((ou) => ou.code.startsWith(code) && ou.id !== parentId).toList(signal);
  }

  async getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    const wanted = new Set(ids);
    if (wanted.size === 0) return [];
    return (await this.organizationUnits(signal)).where((t) => wanted.has(t.id)).toList(signal);
  }

  async getListByRoleId(roleId: Guid, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return (await this.organizationUnits(signal)).where((x) => x.roles.some((r) => r.roleId === roleId)).toList(signal);
  }

  async getListByDisplayNames(displayNames: readonly string[], signal?: AbortSignal): Promise<OrganizationUnit[]> {
    const wanted = new Set(displayNames);
    return (await this.organizationUnits(signal)).where((x) => wanted.has(x.displayName)).toList(signal);
  }

  async getList(options: PagedQueryOptions = {}, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return applyPagedQuery(await this.organizationUnits(signal), options, "creationTime desc").toList(signal);
  }

  async getByDisplayName(displayName: string, signal?: AbortSignal): Promise<OrganizationUnit | undefined> {
    return (await this.organizationUnits(signal)).where((ou) => ou.displayName === displayName).orderBy("id").firstOrDefault(signal);
  }

  async getRoles(organizationUnit: OrganizationUnit, options: PagedQueryOptions = {}, signal?: AbortSignal): Promise<IdentityRole[]> {
    const roleIds = new Set(organizationUnit.roles.map((r) => r.roleId));
    return applyPagedQuery((await this.roles(signal)).where((r) => roleIds.has(r.id)), options, "name").toList(signal);
  }

  async getRolesOfUnits(organizationUnitIds: readonly Guid[], options: PagedQueryOptions = {}, signal?: AbortSignal): Promise<IdentityRole[]> {
    const wanted = new Set(organizationUnitIds);
    const organizationUnits = await (await this.organizationUnits(signal)).where((ou) => wanted.has(ou.id)).toList(signal);
    const roleIds = new Set(organizationUnits.flatMap((ou) => ou.roles.map((r) => r.roleId)));
    return applyPagedQuery((await this.roles(signal)).where((r) => roleIds.has(r.id)), options, "name").toList(signal);
  }

  async getRolesCount(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<number> {
    const roleIds = new Set(organizationUnit.roles.map((r) => r.roleId));
    return (await this.roles(signal)).where((r) => roleIds.has(r.id)).count(signal);
  }

  async getUnaddedRoles(organizationUnit: OrganizationUnit, options: PagedQueryOptions & { filter?: string } = {}, signal?: AbortSignal): Promise<IdentityRole[]> {
    const roleIds = new Set(organizationUnit.roles.map((r) => r.roleId));
    const filter = options.filter;
    return applyPagedQuery((await this.roles(signal)).where((r) => !roleIds.has(r.id) && (isNullOrWhiteSpace(filter) || r.name.includes(filter))), options, "name").toList(signal);
  }

  async getUnaddedRolesCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number> {
    const roleIds = new Set(organizationUnit.roles.map((r) => r.roleId));
    return (await this.roles(signal)).where((r) => !roleIds.has(r.id) && (isNullOrWhiteSpace(filter) || r.name.includes(filter))).count(signal);
  }

  async getMembers(organizationUnit: OrganizationUnit, options: OrganizationUnitMemberOptions = {}, signal?: AbortSignal): Promise<IdentityUser[]> {
    return applyPagedQuery(await this.membersQuery(organizationUnit, options.filter, signal), options, "userName").toList(signal);
  }

  async getMemberIds(id: Guid, includeChildren = false, signal?: AbortSignal): Promise<Guid[]> {
    if (!includeChildren) return (await (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => uou.organizationUnitId === id)).toList(signal)).map((x) => x.id);
    const unit = await (await this.organizationUnits(signal)).where((ou) => ou.id === id).firstOrDefault(signal);
    if (!unit) return [];
    const ids = new Set((await (await this.organizationUnits(signal)).where((ou) => ou.code.startsWith(unit.code)).toList(signal)).map((ou) => ou.id));
    return (await (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => ids.has(uou.organizationUnitId))).toList(signal)).map((x) => x.id);
  }

  async getMembersCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number> {
    return (await this.membersQuery(organizationUnit, filter, signal)).count(signal);
  }

  async getUnaddedUsers(organizationUnit: OrganizationUnit, options: PagedQueryOptions & { filter?: string } = {}, signal?: AbortSignal): Promise<IdentityUser[]> {
    const filter = options.filter;
    return applyPagedQuery((await this.users(signal)).where((u) => !u.organizationUnits.some((uou) => uou.organizationUnitId === organizationUnit.id) && matchesOrganizationUnitMemberFilter(u, filter)), options, "userName").toList(signal);
  }

  async getUnaddedUsersCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number> {
    return (await this.users(signal)).where((u) => !u.organizationUnits.some((uou) => uou.organizationUnitId === organizationUnit.id) && matchesOrganizationUnitMemberFilter(u, filter)).count(signal);
  }

  async removeAllMembers(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<void> {
    const users = await (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => uou.organizationUnitId === organizationUnit.id)).toList(signal);
    for (const user of users) {
      user.removeOrganizationUnit(organizationUnit.id);
      await this.userWriter.update(user, false, signal);
    }
  }

  private async membersQuery(organizationUnit: OrganizationUnit, filter: string | undefined, signal?: AbortSignal): Promise<IQueryable<IdentityUser>> {
    return (await this.users(signal)).where((u) => u.organizationUnits.some((uou) => uou.organizationUnitId === organizationUnit.id) && matchesOrganizationUnitMemberFilter(u, filter));
  }
}

/** The query members of `IIdentityClaimTypeRepository`. */
export class IdentityClaimTypeRepositoryQueries {
  constructor(private readonly claimTypes: QueryableSource<IdentityClaimType>) {}

  async anyByName(name: string, ignoredId?: Guid, signal?: AbortSignal): Promise<boolean> {
    return (await this.claimTypes(signal)).where((ct) => ct.name === name && (ignoredId === undefined || ct.id !== ignoredId)).any(signal);
  }

  async getList(options: PagedQueryOptions & { filter?: string } = {}, signal?: AbortSignal): Promise<IdentityClaimType[]> {
    const filter = options.filter;
    return applyPagedQuery((await this.claimTypes(signal)).where((u) => matchesIdentityClaimTypeFilter(u, filter)), options, "creationTime desc").toList(signal);
  }

  async getCount(filter: string | undefined, signal?: AbortSignal): Promise<number> {
    return (await this.claimTypes(signal)).where((u) => matchesIdentityClaimTypeFilter(u, filter)).count(signal);
  }

  async getListByNames(names: Iterable<string>, signal?: AbortSignal): Promise<IdentityClaimType[]> {
    const wanted = new Set(names);
    return (await this.claimTypes(signal)).where((x) => wanted.has(x.name)).toList(signal);
  }
}

/** The query members of `IIdentitySecurityLogRepository`. */
export class IdentitySecurityLogRepositoryQueries {
  constructor(private readonly logs: QueryableSource<IdentitySecurityLog>) {}

  async getList(options: PagedQueryOptions & IdentitySecurityLogFilterOptions = {}, signal?: AbortSignal): Promise<IdentitySecurityLog[]> {
    return applyPagedQuery((await this.logs(signal)).where((x) => matchesIdentitySecurityLogFilter(x, options)), options, "creationTime desc").toList(signal);
  }

  async getCount(options: IdentitySecurityLogFilterOptions = {}, signal?: AbortSignal): Promise<number> {
    return (await this.logs(signal)).where((x) => matchesIdentitySecurityLogFilter(x, options)).count(signal);
  }

  async getByUserId(id: Guid, userId: Guid, signal?: AbortSignal): Promise<IdentitySecurityLog | undefined> {
    return (await this.logs(signal)).where((x) => x.id === id && x.userId === userId).orderBy("id").firstOrDefault(signal);
  }
}

/** The query members of `IIdentitySessionRepository`. */
export class IdentitySessionRepositoryQueries {
  constructor(
    private readonly sessions: QueryableSource<IdentitySession>,
    private readonly writer: EntityWriter<IdentitySession>,
    private readonly now: () => Date,
  ) {}

  async findBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession | undefined> {
    return (await this.sessions(signal)).where((x) => x.sessionId === sessionId).firstOrDefault(signal);
  }

  async getBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession> {
    const session = await this.findBySessionId(sessionId, signal);
    if (!session) throw new EntityNotFoundException(IdentitySession);
    return session;
  }

  async exists(id: Guid, signal?: AbortSignal): Promise<boolean> {
    return (await this.sessions(signal)).where((x) => x.id === id).any(signal);
  }

  async existsBySessionId(sessionId: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.sessions(signal)).where((x) => x.sessionId === sessionId).any(signal);
  }

  async getList(options: PagedQueryOptions & IdentitySessionFilterOptions = {}, signal?: AbortSignal): Promise<IdentitySession[]> {
    return applyPagedQuery((await this.sessions(signal)).where((x) => matchesIdentitySessionFilter(x, options)), options, "lastAccessed desc").toList(signal);
  }

  async getCount(options: IdentitySessionFilterOptions = {}, signal?: AbortSignal): Promise<number> {
    return (await this.sessions(signal)).where((x) => matchesIdentitySessionFilter(x, options)).count(signal);
  }

  async deleteAllOfUser(userId: Guid, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void> {
    const sessions = await (await this.sessions(signal)).where((x) => x.userId === userId && x.id !== exceptSessionId).toList(signal);
    await this.writer.deleteMany(sessions, false, signal);
  }

  async deleteAllOfUserDevice(userId: Guid, device: string, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void> {
    const sessions = await (await this.sessions(signal)).where((x) => x.userId === userId && x.device === device && x.id !== exceptSessionId).toList(signal);
    await this.writer.deleteMany(sessions, false, signal);
  }

  async deleteAllInactive(inactiveTimeSpanMs: number, signal?: AbortSignal): Promise<void> {
    const inactiveTime = this.now().getTime() - inactiveTimeSpanMs;
    const sessions = await (await this.sessions(signal)).where((x) => (x.lastAccessed ?? x.signedIn).getTime() < inactiveTime).toList(signal);
    await this.writer.deleteMany(sessions, false, signal);
  }
}

/** The query members of `IIdentityLinkUserRepository`. */
export class IdentityLinkUserRepositoryQueries {
  constructor(
    private readonly links: QueryableSource<IdentityLinkUser>,
    private readonly writer: EntityWriter<IdentityLinkUser>,
  ) {}

  async findLink(sourceLinkUserInfo: IdentityLinkUserInfo, targetLinkUserInfo: IdentityLinkUserInfo, signal?: AbortSignal): Promise<IdentityLinkUser | undefined> {
    return (await this.links(signal))
      .where((x) => (x.source.equals(sourceLinkUserInfo) && x.target.equals(targetLinkUserInfo)) || (x.target.equals(sourceLinkUserInfo) && x.source.equals(targetLinkUserInfo)))
      .orderBy("id")
      .firstOrDefault(signal);
  }

  async getListOf(linkUserInfo: IdentityLinkUserInfo, excludes: readonly IdentityLinkUserInfo[] = [], signal?: AbortSignal): Promise<IdentityLinkUser[]> {
    return (await this.links(signal)).where((x) => matchesLinkUser(x, linkUserInfo, excludes)).toList(signal);
  }

  async getAllInBatches(batchSize: number, signal?: AbortSignal): Promise<IdentityLinkUser[]> {
    const result: IdentityLinkUser[] = [];
    const total = await (await this.links(signal)).count(signal);
    const pages = Math.ceil(total / batchSize);
    for (let page = 0; page < pages; page++) result.push(...(await (await this.links(signal)).orderBy("id").skip(page * batchSize).take(batchSize).toList(signal)));
    return result;
  }

  async deleteAllOf(linkUserInfo: IdentityLinkUserInfo, signal?: AbortSignal): Promise<void> {
    const linkUsers = await (await this.links(signal)).where((x) => x.involves(linkUserInfo)).toList(signal);
    await this.writer.deleteMany(linkUsers, false, signal);
  }
}

/** The query members of `IIdentityUserDelegationRepository`. */
export class IdentityUserDelegationRepositoryQueries {
  constructor(
    private readonly delegations: QueryableSource<IdentityUserDelegation>,
    private readonly now: () => Date,
  ) {}

  async getListOf(sourceUserId: Guid | undefined, targetUserId: Guid | undefined, signal?: AbortSignal): Promise<IdentityUserDelegation[]> {
    return (await this.delegations(signal)).where((x) => (sourceUserId === undefined || x.sourceUserId === sourceUserId) && (targetUserId === undefined || x.targetUserId === targetUserId)).toList(signal);
  }

  async getActiveDelegations(targetUserId: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation[]> {
    const now = this.now();
    return (await this.delegations(signal)).where((x) => x.targetUserId === targetUserId && x.isActiveAt(now)).toList(signal);
  }

  async findActiveDelegationById(id: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation | undefined> {
    const now = this.now();
    return (await this.delegations(signal)).where((x) => x.id === id && x.isActiveAt(now)).firstOrDefault(signal);
  }
}
