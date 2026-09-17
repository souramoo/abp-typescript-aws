import { Transient, type Guid } from "@abp/core";
import { isPredicate, repositoryToken, type EntityPredicate } from "@abp/ddd-domain";
import { MemoryDbRepository, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import type { Claim } from "@abp/security";
import { IClock } from "@abp/timing";
import {
  IIdentityClaimTypeRepository,
  IIdentityLinkUserRepository,
  IIdentityRoleRepository,
  IIdentitySecurityLogRepository,
  IIdentitySessionRepository,
  IIdentityUserDelegationRepository,
  IIdentityUserRepository,
  IOrganizationUnitRepository,
  IdentityClaimType,
  IdentityClaimTypeRepositoryQueries,
  IdentityLinkUser,
  IdentityLinkUserRepositoryQueries,
  IdentityRole,
  IdentityRoleRepositoryQueries,
  IdentitySecurityLog,
  IdentitySecurityLogRepositoryQueries,
  IdentitySession,
  IdentitySessionRepositoryQueries,
  IdentityUser,
  IdentityUserDelegation,
  IdentityUserDelegationRepositoryQueries,
  IdentityUserRepositoryQueries,
  OrganizationUnit,
  OrganizationUnitRepositoryQueries,
  type IdentityLinkUserInfo,
  type IdentityRoleListOptions,
  type IdentityRoleWithUserCount,
  type IdentitySecurityLogFilterOptions,
  type IdentitySessionFilterOptions,
  type IdentityUserFilterOptions,
  type IdentityUserIdWithRoleNames,
  type IdentityUserListOptions,
  type OrganizationUnitMemberOptions,
  type PagedQueryOptions,
} from "../domain/index.js";
import { IdentityMemoryDbContext } from "./identity-memory-db-context.js";

const databaseProviderToken = memoryDatabaseProviderToken(IdentityMemoryDbContext);

/** In-memory `IIdentityUserRepository` (the query bodies live in `IdentityUserRepositoryQueries`). */
@Transient(IIdentityUserRepository)
export class MemoryDbIdentityUserRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentityUser, Guid> implements IIdentityUserRepository {
  static readonly inject = [databaseProviderToken] as const;
  private queriesCache: IdentityUserRepositoryQueries | undefined;

  constructor(databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>) {
    super(databaseProvider, IdentityUser);
  }

  private get queries(): IdentityUserRepositoryQueries {
    this.queriesCache ??= new IdentityUserRepositoryQueries(
      () => this.getQueryable(),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityRole)).getQueryable(),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(OrganizationUnit)).getQueryable(),
      this,
      (id, signal) => this.get(id, true, signal),
    );
    return this.queriesCache;
  }

  findByNormalizedUserName(normalizedUserName: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return this.queries.findByNormalizedUserName(normalizedUserName, signal);
  }
  findByNormalizedEmail(normalizedEmail: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return this.queries.findByNormalizedEmail(normalizedEmail, signal);
  }
  findByLogin(loginProvider: string, providerKey: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return this.queries.findByLogin(loginProvider, providerKey, signal);
  }
  getRoleNames(id: Guid, signal?: AbortSignal): Promise<string[]> {
    return this.queries.getRoleNames(id, signal);
  }
  getRoleNamesInOrganizationUnit(id: Guid, signal?: AbortSignal): Promise<string[]> {
    return this.queries.getRoleNamesInOrganizationUnit(id, signal);
  }
  getListByClaim(claim: Claim, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getListByClaim(claim, signal);
  }
  removeClaimFromAllUsers(claimType: string, autoSave = false, signal?: AbortSignal): Promise<void> {
    return this.queries.removeClaimFromAllUsers(claimType, autoSave, signal);
  }
  getListByNormalizedRoleName(normalizedRoleName: string, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getListByNormalizedRoleName(normalizedRoleName, signal);
  }
  getUserIdListByRoleId(roleId: Guid, signal?: AbortSignal): Promise<Guid[]> {
    return this.queries.getUserIdListByRoleId(roleId, signal);
  }
  override getList(optionsOrPredicate?: IdentityUserListOptions | EntityPredicate<IdentityUser> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<IdentityUser[]> {
    if (isPredicate<IdentityUser>(optionsOrPredicate)) return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
    if (typeof optionsOrPredicate === "object") return this.queries.getList(optionsOrPredicate, includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
    return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
  }
  getRoles(id: Guid, _includeDetails = false, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getRoles(id, signal);
  }
  getOrganizationUnits(id: Guid, _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return this.queries.getOrganizationUnits(id, signal);
  }
  getUsersInOrganizationUnit(organizationUnitId: Guid, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersInOrganizationUnit(organizationUnitId, signal);
  }
  getUsersInOrganizationsList(organizationUnitIds: readonly Guid[], signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersInOrganizationsList(organizationUnitIds, signal);
  }
  getUsersInOrganizationUnitWithChildren(code: string, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersInOrganizationUnitWithChildren(code, signal);
  }
  override getCount(optionsOrSignal?: IdentityUserFilterOptions | AbortSignal, signal?: AbortSignal): Promise<number> {
    if (optionsOrSignal instanceof AbortSignal || optionsOrSignal === undefined) return super.getCount(optionsOrSignal);
    return this.queries.getCount(optionsOrSignal, signal);
  }
  findByTenantIdAndUserName(userName: string, tenantId: Guid | undefined, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return this.queries.findByTenantIdAndUserName(userName, tenantId, signal);
  }
  getListByIds(ids: Iterable<Guid>, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getListByIds(ids, signal);
  }
  updateRole(sourceRoleId: Guid, targetRoleId: Guid | undefined, signal?: AbortSignal): Promise<void> {
    return this.queries.updateRole(sourceRoleId, targetRoleId, signal);
  }
  updateOrganization(sourceOrganizationId: Guid, targetOrganizationId: Guid | undefined, signal?: AbortSignal): Promise<void> {
    return this.queries.updateOrganization(sourceOrganizationId, targetOrganizationId, signal);
  }
  getRoleNamesOfUsers(userIds: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityUserIdWithRoleNames[]> {
    return this.queries.getRoleNamesOfUsers(userIds, signal);
  }
  getUsersByNormalizedUserName(normalizedUserName: string, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersByNormalizedUserName(normalizedUserName, signal);
  }
  getUsersByNormalizedUserNames(normalizedUserNames: readonly string[], _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersByNormalizedUserNames(normalizedUserNames, signal);
  }
  getUsersByNormalizedEmail(normalizedEmail: string, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersByNormalizedEmail(normalizedEmail, signal);
  }
  getUsersByNormalizedEmails(normalizedEmails: readonly string[], _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersByNormalizedEmails(normalizedEmails, signal);
  }
  getUsersByLogin(loginProvider: string, providerKey: string, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersByLogin(loginProvider, providerKey, signal);
  }
  findByTenantIdAndNormalizedUserName(tenantId: Guid | undefined, normalizedUserName: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return this.queries.findByTenantIdAndNormalizedUserName(tenantId, normalizedUserName, signal);
  }
  findByTenantIdAndNormalizedEmail(tenantId: Guid | undefined, normalizedEmail: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return this.queries.findByTenantIdAndNormalizedEmail(tenantId, normalizedEmail, signal);
  }
}

@Transient(IIdentityRoleRepository)
export class MemoryDbIdentityRoleRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentityRole, Guid> implements IIdentityRoleRepository {
  static readonly inject = [databaseProviderToken] as const;
  private queriesCache: IdentityRoleRepositoryQueries | undefined;

  constructor(databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>) {
    super(databaseProvider, IdentityRole);
  }

  private get queries(): IdentityRoleRepositoryQueries {
    this.queriesCache ??= new IdentityRoleRepositoryQueries(() => this.getQueryable(), () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUser)).getQueryable(), this);
    return this.queriesCache;
  }

  findByNormalizedName(normalizedRoleName: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityRole | undefined> {
    return this.queries.findByNormalizedName(normalizedRoleName, signal);
  }
  getListWithUserCount(options?: IdentityRoleListOptions, signal?: AbortSignal): Promise<IdentityRoleWithUserCount[]> {
    return this.queries.getListWithUserCount(options, signal);
  }
  override getList(optionsOrPredicate?: IdentityRoleListOptions | EntityPredicate<IdentityRole> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<IdentityRole[]> {
    if (isPredicate<IdentityRole>(optionsOrPredicate)) return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
    if (typeof optionsOrPredicate === "object") return this.queries.getList(optionsOrPredicate, includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
    return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
  }
  getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getListByIds(ids, signal);
  }
  getListByNames(names: Iterable<string>, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getListByNames(names, signal);
  }
  getDefaultOnes(_includeDetails = false, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getDefaultOnes(signal);
  }
  override getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number> {
    if (typeof filterOrSignal === "string") return this.queries.getCount(filterOrSignal, signal);
    return super.getCount(filterOrSignal);
  }
  removeClaimFromAllRoles(claimType: string, autoSave = false, signal?: AbortSignal): Promise<void> {
    return this.queries.removeClaimFromAllRoles(claimType, autoSave, signal);
  }
}

@Transient(IOrganizationUnitRepository)
export class MemoryDbOrganizationUnitRepository extends MemoryDbRepository<IdentityMemoryDbContext, OrganizationUnit, Guid> implements IOrganizationUnitRepository {
  static readonly inject = [databaseProviderToken] as const;
  private queriesCache: OrganizationUnitRepositoryQueries | undefined;

  constructor(databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>) {
    super(databaseProvider, OrganizationUnit);
  }

  private get queries(): OrganizationUnitRepositoryQueries {
    this.queriesCache ??= new OrganizationUnitRepositoryQueries(
      () => this.getQueryable(),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityRole)).getQueryable(),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUser)).getQueryable(),
      this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUser)),
    );
    return this.queriesCache;
  }

  getChildren(parentId: Guid | undefined, _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return this.queries.getChildren(parentId, signal);
  }
  getAllChildrenWithParentCode(code: string, parentId: Guid | undefined, _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return this.queries.getAllChildrenWithParentCode(code, parentId, signal);
  }
  getByDisplayName(displayName: string, _includeDetails = true, signal?: AbortSignal): Promise<OrganizationUnit | undefined> {
    return this.queries.getByDisplayName(displayName, signal);
  }
  override getList(optionsOrPredicate?: (PagedQueryOptions & { includeDetails?: boolean }) | EntityPredicate<OrganizationUnit> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    if (isPredicate<OrganizationUnit>(optionsOrPredicate)) return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
    if (typeof optionsOrPredicate === "object") return this.queries.getList(optionsOrPredicate, includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
    return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
  }
  getListByIds(ids: Iterable<Guid>, _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return this.queries.getListByIds(ids, signal);
  }
  getListByRoleId(roleId: Guid, _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return this.queries.getListByRoleId(roleId, signal);
  }
  getListByDisplayNames(displayNames: readonly string[], _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return this.queries.getListByDisplayNames(displayNames, signal);
  }
  getRoles(organizationUnit: OrganizationUnit, options?: PagedQueryOptions, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getRoles(organizationUnit, options, signal);
  }
  getRolesOfUnits(organizationUnitIds: readonly Guid[], options?: PagedQueryOptions, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getRolesOfUnits(organizationUnitIds, options, signal);
  }
  getRolesCount(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<number> {
    return this.queries.getRolesCount(organizationUnit, signal);
  }
  getUnaddedRoles(organizationUnit: OrganizationUnit, options?: PagedQueryOptions & { filter?: string }, signal?: AbortSignal): Promise<IdentityRole[]> {
    return this.queries.getUnaddedRoles(organizationUnit, options, signal);
  }
  getUnaddedRolesCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number> {
    return this.queries.getUnaddedRolesCount(organizationUnit, filter, signal);
  }
  getMembers(organizationUnit: OrganizationUnit, options?: OrganizationUnitMemberOptions, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getMembers(organizationUnit, options, signal);
  }
  getMemberIds(id: Guid, includeChildren = false, signal?: AbortSignal): Promise<Guid[]> {
    return this.queries.getMemberIds(id, includeChildren, signal);
  }
  getMembersCount(organizationUnit: OrganizationUnit, filter?: string, _includeChildren = false, signal?: AbortSignal): Promise<number> {
    return this.queries.getMembersCount(organizationUnit, filter, signal);
  }
  getUnaddedUsers(organizationUnit: OrganizationUnit, options?: PagedQueryOptions & { filter?: string }, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUnaddedUsers(organizationUnit, options, signal);
  }
  getUnaddedUsersCount(organizationUnit: OrganizationUnit, filter?: string, signal?: AbortSignal): Promise<number> {
    return this.queries.getUnaddedUsersCount(organizationUnit, filter, signal);
  }
  async removeAllRoles(organizationUnit: OrganizationUnit): Promise<void> {
    organizationUnit.roles.length = 0;
  }
  removeAllMembers(organizationUnit: OrganizationUnit, signal?: AbortSignal): Promise<void> {
    return this.queries.removeAllMembers(organizationUnit, signal);
  }
}

@Transient(IIdentityClaimTypeRepository)
export class MemoryDbIdentityClaimTypeRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentityClaimType, Guid> implements IIdentityClaimTypeRepository {
  static readonly inject = [databaseProviderToken] as const;
  private queriesCache: IdentityClaimTypeRepositoryQueries | undefined;

  constructor(databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>) {
    super(databaseProvider, IdentityClaimType);
  }

  private get queries(): IdentityClaimTypeRepositoryQueries {
    this.queriesCache ??= new IdentityClaimTypeRepositoryQueries(() => this.getQueryable());
    return this.queriesCache;
  }

  anyByName(name: string, ignoredId?: Guid, signal?: AbortSignal): Promise<boolean> {
    return this.queries.anyByName(name, ignoredId, signal);
  }
  override getList(optionsOrPredicate?: (PagedQueryOptions & { filter?: string }) | EntityPredicate<IdentityClaimType> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<IdentityClaimType[]> {
    if (isPredicate<IdentityClaimType>(optionsOrPredicate)) return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
    if (typeof optionsOrPredicate === "object") return this.queries.getList(optionsOrPredicate, includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
    return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
  }
  override getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number> {
    if (typeof filterOrSignal === "string") return this.queries.getCount(filterOrSignal, signal);
    return super.getCount(filterOrSignal);
  }
  getListByNames(names: Iterable<string>, signal?: AbortSignal): Promise<IdentityClaimType[]> {
    return this.queries.getListByNames(names, signal);
  }
}

@Transient(IIdentitySecurityLogRepository)
export class MemoryDbIdentitySecurityLogRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentitySecurityLog, Guid> implements IIdentitySecurityLogRepository {
  static readonly inject = [databaseProviderToken] as const;
  private queriesCache: IdentitySecurityLogRepositoryQueries | undefined;

  constructor(databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>) {
    super(databaseProvider, IdentitySecurityLog);
  }

  private get queries(): IdentitySecurityLogRepositoryQueries {
    this.queriesCache ??= new IdentitySecurityLogRepositoryQueries(() => this.getQueryable());
    return this.queriesCache;
  }

  override getList(optionsOrPredicate?: (PagedQueryOptions & IdentitySecurityLogFilterOptions & { includeDetails?: boolean }) | EntityPredicate<IdentitySecurityLog> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<IdentitySecurityLog[]> {
    if (isPredicate<IdentitySecurityLog>(optionsOrPredicate)) return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
    if (typeof optionsOrPredicate === "object") return this.queries.getList(optionsOrPredicate, includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
    return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
  }
  override getCount(optionsOrSignal?: IdentitySecurityLogFilterOptions | AbortSignal, signal?: AbortSignal): Promise<number> {
    if (optionsOrSignal instanceof AbortSignal || optionsOrSignal === undefined) return super.getCount(optionsOrSignal);
    return this.queries.getCount(optionsOrSignal, signal);
  }
  getByUserId(id: Guid, userId: Guid, _includeDetails = false, signal?: AbortSignal): Promise<IdentitySecurityLog | undefined> {
    return this.queries.getByUserId(id, userId, signal);
  }
}

@Transient(IIdentitySessionRepository)
export class MemoryDbIdentitySessionRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentitySession, Guid> implements IIdentitySessionRepository {
  static readonly inject = [databaseProviderToken, IClock] as const;
  private queriesCache: IdentitySessionRepositoryQueries | undefined;

  constructor(
    databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>,
    protected readonly clock: IClock,
  ) {
    super(databaseProvider, IdentitySession);
  }

  private get queries(): IdentitySessionRepositoryQueries {
    this.queriesCache ??= new IdentitySessionRepositoryQueries(() => this.getQueryable(), this, () => this.clock.now);
    return this.queriesCache;
  }

  findBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession | undefined> {
    return this.queries.findBySessionId(sessionId, signal);
  }
  getBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession> {
    return this.queries.getBySessionId(sessionId, signal);
  }
  exists(id: Guid, signal?: AbortSignal): Promise<boolean> {
    return this.queries.exists(id, signal);
  }
  existsBySessionId(sessionId: string, signal?: AbortSignal): Promise<boolean> {
    return this.queries.existsBySessionId(sessionId, signal);
  }
  override getList(optionsOrPredicate?: (PagedQueryOptions & IdentitySessionFilterOptions) | EntityPredicate<IdentitySession> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<IdentitySession[]> {
    if (isPredicate<IdentitySession>(optionsOrPredicate)) return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
    if (typeof optionsOrPredicate === "object") return this.queries.getList(optionsOrPredicate, includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
    return super.getList(optionsOrPredicate, includeDetailsOrSignal, signal);
  }
  override getCount(optionsOrSignal?: IdentitySessionFilterOptions | AbortSignal, signal?: AbortSignal): Promise<number> {
    if (optionsOrSignal instanceof AbortSignal || optionsOrSignal === undefined) return super.getCount(optionsOrSignal);
    return this.queries.getCount(optionsOrSignal, signal);
  }
  deleteAllOfUser(userId: Guid, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void> {
    return this.queries.deleteAllOfUser(userId, exceptSessionId, signal);
  }
  deleteAllOfUserDevice(userId: Guid, device: string, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void> {
    return this.queries.deleteAllOfUserDevice(userId, device, exceptSessionId, signal);
  }
  deleteAllInactive(inactiveTimeSpanMs: number, signal?: AbortSignal): Promise<void> {
    return this.queries.deleteAllInactive(inactiveTimeSpanMs, signal);
  }
}

@Transient(IIdentityLinkUserRepository)
export class MemoryDbIdentityLinkUserRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentityLinkUser, Guid> implements IIdentityLinkUserRepository {
  static readonly inject = [databaseProviderToken] as const;
  private queriesCache: IdentityLinkUserRepositoryQueries | undefined;

  constructor(databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>) {
    super(databaseProvider, IdentityLinkUser);
  }

  private get queries(): IdentityLinkUserRepositoryQueries {
    this.queriesCache ??= new IdentityLinkUserRepositoryQueries(() => this.getQueryable(), this);
    return this.queriesCache;
  }

  findLink(sourceLinkUserInfo: IdentityLinkUserInfo, targetLinkUserInfo: IdentityLinkUserInfo, signal?: AbortSignal): Promise<IdentityLinkUser | undefined> {
    return this.queries.findLink(sourceLinkUserInfo, targetLinkUserInfo, signal);
  }
  getListOf(linkUserInfo: IdentityLinkUserInfo, excludes?: readonly IdentityLinkUserInfo[], signal?: AbortSignal): Promise<IdentityLinkUser[]> {
    return this.queries.getListOf(linkUserInfo, excludes, signal);
  }
  getAllInBatches(batchSize: number, signal?: AbortSignal): Promise<IdentityLinkUser[]> {
    return this.queries.getAllInBatches(batchSize, signal);
  }
  deleteAllOf(linkUserInfo: IdentityLinkUserInfo, signal?: AbortSignal): Promise<void> {
    return this.queries.deleteAllOf(linkUserInfo, signal);
  }
}

@Transient(IIdentityUserDelegationRepository)
export class MemoryDbIdentityUserDelegationRepository extends MemoryDbRepository<IdentityMemoryDbContext, IdentityUserDelegation, Guid> implements IIdentityUserDelegationRepository {
  static readonly inject = [databaseProviderToken, IClock] as const;
  private queriesCache: IdentityUserDelegationRepositoryQueries | undefined;

  constructor(
    databaseProvider: IMemoryDatabaseProvider<IdentityMemoryDbContext>,
    protected readonly clock: IClock,
  ) {
    super(databaseProvider, IdentityUserDelegation);
  }

  private get queries(): IdentityUserDelegationRepositoryQueries {
    this.queriesCache ??= new IdentityUserDelegationRepositoryQueries(() => this.getQueryable(), () => this.clock.now);
    return this.queriesCache;
  }

  getListOf(sourceUserId: Guid | undefined, targetUserId: Guid | undefined, signal?: AbortSignal): Promise<IdentityUserDelegation[]> {
    return this.queries.getListOf(sourceUserId, targetUserId, signal);
  }
  getActiveDelegations(targetUserId: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation[]> {
    return this.queries.getActiveDelegations(targetUserId, signal);
  }
  findActiveDelegationById(id: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation | undefined> {
    return this.queries.findActiveDelegationById(id, signal);
  }
}
