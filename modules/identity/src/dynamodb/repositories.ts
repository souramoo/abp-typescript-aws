import { Transient, type Guid } from "@abp/core";
import { isPredicate, repositoryToken, type EntityPredicate, type IRepository } from "@abp/ddd-domain";
import { DynamoDbRepository, dynamoDbContextProviderToken, type DynamoDbEntityConfiguration, type DynamoDbItem, type IDynamoDbContextProvider } from "@abp/dynamodb";
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
  IdentityRoleClaim,
  IdentityRoleRepositoryQueries,
  IdentitySecurityLog,
  IdentitySecurityLogRepositoryQueries,
  IdentitySession,
  IdentitySessionRepositoryQueries,
  IdentityUser,
  IdentityUserClaim,
  IdentityUserDelegation,
  IdentityUserDelegationRepositoryQueries,
  IdentityUserLogin,
  IdentityUserOrganizationUnit,
  IdentityUserRepositoryQueries,
  IdentityUserRole,
  IdentityUserToken,
  OrganizationUnit,
  OrganizationUnitRepositoryQueries,
  OrganizationUnitRole,
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
import { IdentityDynamoDbContext, IdentityUserLoginIndex } from "./identity-dynamodb-context.js";

const contextProviderToken = dynamoDbContextProviderToken(IdentityDynamoDbContext);

function rehydrate<T extends object>(items: unknown, prototype: T): void {
  if (!Array.isArray(items)) return;
  for (const item of items) if (typeof item === "object" && item !== null) Object.setPrototypeOf(item, prototype);
}

/**
 * Port of `MongoIdentityUserRepository`. `findByNormalizedUserName`/`findByNormalizedEmail` query `gsi2`/`gsi3`;
 * `findByLogin` goes through the `IdentityUserLoginIndex` items this repository maintains; every other query is a
 * filter over the tenant partition (`IdentityUserRepositoryQueries`).
 */
@Transient(IIdentityUserRepository)
export class DynamoDbIdentityUserRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentityUser, Guid> implements IIdentityUserRepository {
  static readonly inject = [contextProviderToken] as const;
  private queriesCache: IdentityUserRepositoryQueries | undefined;

  constructor(dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>) {
    super(dbContextProvider, IdentityUser);
  }

  private get queries(): IdentityUserRepositoryQueries {
    this.queriesCache ??= new IdentityUserRepositoryQueries(
      (signal) => this.getDynamoDbQueryable(signal),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityRole)).getQueryable(),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(OrganizationUnit)).getQueryable(),
      this,
      (id, signal) => this.get(id, true, signal),
    );
    return this.queriesCache;
  }

  private get loginIndex(): IRepository<IdentityUserLoginIndex, string> {
    return this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUserLoginIndex));
  }

  protected override toEntity(item: DynamoDbItem, configuration: DynamoDbEntityConfiguration<IdentityUser>): IdentityUser {
    const user = super.toEntity(item, configuration);
    rehydrate(user.roles, IdentityUserRole.prototype);
    rehydrate(user.claims, IdentityUserClaim.prototype);
    rehydrate(user.logins, IdentityUserLogin.prototype);
    rehydrate(user.tokens, IdentityUserToken.prototype);
    rehydrate(user.organizationUnits, IdentityUserOrganizationUnit.prototype);
    return user;
  }

  override async insert(entity: IdentityUser, autoSave = false, signal?: AbortSignal): Promise<IdentityUser> {
    await super.insert(entity, false, signal);
    await this.syncLoginIndex(entity, signal);
    if (autoSave) await this.saveChanges(signal);
    return entity;
  }

  override async update(entity: IdentityUser, autoSave = false, signal?: AbortSignal): Promise<IdentityUser> {
    await super.update(entity, false, signal);
    await this.syncLoginIndex(entity, signal);
    if (autoSave) await this.saveChanges(signal);
    return entity;
  }

  override async delete(entity: IdentityUser, autoSave = false, signal?: AbortSignal): Promise<void> {
    await super.delete(entity, false, signal);
    for (const item of await this.loginIndexItemsOf(entity.id, signal)) await this.loginIndex.delete(item, false, signal);
    if (autoSave) await this.saveChanges(signal);
  }

  /** Keeps the `IdentityUserLoginIndex` items equal to the user's embedded logins. */
  private async syncLoginIndex(user: IdentityUser, signal?: AbortSignal): Promise<void> {
    const existing = await this.loginIndexItemsOf(user.id, signal);
    const wanted = new Map(user.logins.map((l) => [IdentityUserLoginIndex.keyOf(l.loginProvider, l.providerKey), l]));
    for (const item of existing) if (!wanted.has(item.id)) await this.loginIndex.delete(item, false, signal);
    const existingKeys = new Set(existing.map((i) => i.id));
    for (const [key, login] of wanted) {
      if (!existingKeys.has(key)) await this.loginIndex.insert(new IdentityUserLoginIndex(user.id, login.loginProvider, login.providerKey, user.tenantId), false, signal);
    }
  }

  private async loginIndexItemsOf(userId: Guid, signal?: AbortSignal): Promise<IdentityUserLoginIndex[]> {
    const repository = this.loginIndex as unknown as DynamoDbRepository<IdentityDynamoDbContext, IdentityUserLoginIndex, string>;
    return (await repository.getDynamoDbQueryable(signal)).usingIndex("gsi2", userId).toList(signal);
  }

  async findByNormalizedUserName(normalizedUserName: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", normalizedUserName).orderBy("id").firstOrDefault(signal);
  }

  async findByNormalizedEmail(normalizedEmail: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi3", normalizedEmail).orderBy("id").firstOrDefault(signal);
  }

  async findByLogin(loginProvider: string, providerKey: string, includeDetails = true, signal?: AbortSignal): Promise<IdentityUser | undefined> {
    const index = await this.loginIndex.find(IdentityUserLoginIndex.keyOf(loginProvider, providerKey), false, signal);
    if (!index) return undefined;
    return this.find(index.userId, includeDetails, signal);
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
  async getUsersByNormalizedUserName(normalizedUserName: string, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", normalizedUserName).orderBy("id").toList(signal);
  }
  getUsersByNormalizedUserNames(normalizedUserNames: readonly string[], _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return this.queries.getUsersByNormalizedUserNames(normalizedUserNames, signal);
  }
  async getUsersByNormalizedEmail(normalizedEmail: string, _includeDetails = false, signal?: AbortSignal): Promise<IdentityUser[]> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi3", normalizedEmail).orderBy("id").toList(signal);
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

/** Port of `MongoIdentityRoleRepository` (`findByNormalizedName` through `gsi2`). */
@Transient(IIdentityRoleRepository)
export class DynamoDbIdentityRoleRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentityRole, Guid> implements IIdentityRoleRepository {
  static readonly inject = [contextProviderToken] as const;
  private queriesCache: IdentityRoleRepositoryQueries | undefined;

  constructor(dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>) {
    super(dbContextProvider, IdentityRole);
  }

  private get queries(): IdentityRoleRepositoryQueries {
    this.queriesCache ??= new IdentityRoleRepositoryQueries((signal) => this.getDynamoDbQueryable(signal), () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUser)).getQueryable(), this);
    return this.queriesCache;
  }

  protected override toEntity(item: DynamoDbItem, configuration: DynamoDbEntityConfiguration<IdentityRole>): IdentityRole {
    const role = super.toEntity(item, configuration);
    rehydrate(role.claims, IdentityRoleClaim.prototype);
    return role;
  }

  async findByNormalizedName(normalizedRoleName: string, _includeDetails = true, signal?: AbortSignal): Promise<IdentityRole | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", normalizedRoleName).orderBy("id").firstOrDefault(signal);
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

/** Port of `MongoOrganizationUnitRepository` (children through `gsi2` keyed by the parent id). */
@Transient(IOrganizationUnitRepository)
export class DynamoDbOrganizationUnitRepository extends DynamoDbRepository<IdentityDynamoDbContext, OrganizationUnit, Guid> implements IOrganizationUnitRepository {
  static readonly inject = [contextProviderToken] as const;
  private queriesCache: OrganizationUnitRepositoryQueries | undefined;

  constructor(dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>) {
    super(dbContextProvider, OrganizationUnit);
  }

  private get queries(): OrganizationUnitRepositoryQueries {
    this.queriesCache ??= new OrganizationUnitRepositoryQueries(
      (signal) => this.getDynamoDbQueryable(signal),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityRole)).getQueryable(),
      () => this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUser)).getQueryable(),
      this.lazyServiceProvider.lazyGetRequiredService(repositoryToken(IdentityUser)),
    );
    return this.queriesCache;
  }

  protected override toEntity(item: DynamoDbItem, configuration: DynamoDbEntityConfiguration<OrganizationUnit>): OrganizationUnit {
    const organizationUnit = super.toEntity(item, configuration);
    rehydrate(organizationUnit.roles, OrganizationUnitRole.prototype);
    return organizationUnit;
  }

  async getChildren(parentId: Guid | undefined, _includeDetails = false, signal?: AbortSignal): Promise<OrganizationUnit[]> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", parentId ?? "root").toList(signal);
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

/** Port of `MongoIdentityClaimTypeRepository` (`anyByName` through `gsi2`). */
@Transient(IIdentityClaimTypeRepository)
export class DynamoDbIdentityClaimTypeRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentityClaimType, Guid> implements IIdentityClaimTypeRepository {
  static readonly inject = [contextProviderToken] as const;
  private queriesCache: IdentityClaimTypeRepositoryQueries | undefined;

  constructor(dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>) {
    super(dbContextProvider, IdentityClaimType);
  }

  private get queries(): IdentityClaimTypeRepositoryQueries {
    this.queriesCache ??= new IdentityClaimTypeRepositoryQueries((signal) => this.getDynamoDbQueryable(signal));
    return this.queriesCache;
  }

  async anyByName(name: string, ignoredId?: Guid, signal?: AbortSignal): Promise<boolean> {
    return (await this.getDynamoDbQueryable(signal))
      .usingIndex("gsi2", name)
      .where((ct) => ignoredId === undefined || ct.id !== ignoredId)
      .any(signal);
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

/** Port of `MongoIdentitySecurityLogRepository` (`userId` filters through `gsi2`, sorted by creation time). */
@Transient(IIdentitySecurityLogRepository)
export class DynamoDbIdentitySecurityLogRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentitySecurityLog, Guid> implements IIdentitySecurityLogRepository {
  static readonly inject = [contextProviderToken] as const;
  private queriesCache: IdentitySecurityLogRepositoryQueries | undefined;

  constructor(dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>) {
    super(dbContextProvider, IdentitySecurityLog);
  }

  private get queries(): IdentitySecurityLogRepositoryQueries {
    this.queriesCache ??= new IdentitySecurityLogRepositoryQueries((signal) => this.getDynamoDbQueryable(signal));
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
  async getByUserId(id: Guid, userId: Guid, _includeDetails = false, signal?: AbortSignal): Promise<IdentitySecurityLog | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", userId).where((x) => x.id === id).firstOrDefault(signal);
  }
}

/** Port of `MongoIdentitySessionRepository` (`sessionId` through `gsi2`, `userId` through `gsi3`). */
@Transient(IIdentitySessionRepository)
export class DynamoDbIdentitySessionRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentitySession, Guid> implements IIdentitySessionRepository {
  static readonly inject = [contextProviderToken, IClock] as const;
  private queriesCache: IdentitySessionRepositoryQueries | undefined;

  constructor(
    dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>,
    protected readonly clock: IClock,
  ) {
    super(dbContextProvider, IdentitySession);
  }

  private get queries(): IdentitySessionRepositoryQueries {
    this.queriesCache ??= new IdentitySessionRepositoryQueries((signal) => this.getDynamoDbQueryable(signal), this, () => this.clock.now);
    return this.queriesCache;
  }

  async findBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", sessionId).firstOrDefault(signal);
  }
  getBySessionId(sessionId: string, signal?: AbortSignal): Promise<IdentitySession> {
    return this.queries.getBySessionId(sessionId, signal);
  }
  async exists(id: Guid, signal?: AbortSignal): Promise<boolean> {
    return (await this.find(id, false, signal)) !== undefined;
  }
  async existsBySessionId(sessionId: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.findBySessionId(sessionId, signal)) !== undefined;
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
  async deleteAllOfUser(userId: Guid, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void> {
    const sessions = await (await this.getDynamoDbQueryable(signal)).usingIndex("gsi3", userId).where((x) => x.id !== exceptSessionId).toList(signal);
    await this.deleteMany(sessions, false, signal);
  }
  async deleteAllOfUserDevice(userId: Guid, device: string, exceptSessionId?: Guid, signal?: AbortSignal): Promise<void> {
    const sessions = await (await this.getDynamoDbQueryable(signal)).usingIndex("gsi3", userId).where((x) => x.device === device && x.id !== exceptSessionId).toList(signal);
    await this.deleteMany(sessions, false, signal);
  }
  deleteAllInactive(inactiveTimeSpanMs: number, signal?: AbortSignal): Promise<void> {
    return this.queries.deleteAllInactive(inactiveTimeSpanMs, signal);
  }
}

/** Port of `MongoIdentityLinkUserRepository`. */
@Transient(IIdentityLinkUserRepository)
export class DynamoDbIdentityLinkUserRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentityLinkUser, Guid> implements IIdentityLinkUserRepository {
  static readonly inject = [contextProviderToken] as const;
  private queriesCache: IdentityLinkUserRepositoryQueries | undefined;

  constructor(dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>) {
    super(dbContextProvider, IdentityLinkUser);
  }

  private get queries(): IdentityLinkUserRepositoryQueries {
    this.queriesCache ??= new IdentityLinkUserRepositoryQueries((signal) => this.getDynamoDbQueryable(signal), this);
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

/** Port of `MongoIdentityUserDelegationRepository` (`targetUserId` through `gsi2`). */
@Transient(IIdentityUserDelegationRepository)
export class DynamoDbIdentityUserDelegationRepository extends DynamoDbRepository<IdentityDynamoDbContext, IdentityUserDelegation, Guid> implements IIdentityUserDelegationRepository {
  static readonly inject = [contextProviderToken, IClock] as const;
  private queriesCache: IdentityUserDelegationRepositoryQueries | undefined;

  constructor(
    dbContextProvider: IDynamoDbContextProvider<IdentityDynamoDbContext>,
    protected readonly clock: IClock,
  ) {
    super(dbContextProvider, IdentityUserDelegation);
  }

  private get queries(): IdentityUserDelegationRepositoryQueries {
    this.queriesCache ??= new IdentityUserDelegationRepositoryQueries((signal) => this.getDynamoDbQueryable(signal), () => this.clock.now);
    return this.queriesCache;
  }

  getListOf(sourceUserId: Guid | undefined, targetUserId: Guid | undefined, signal?: AbortSignal): Promise<IdentityUserDelegation[]> {
    return this.queries.getListOf(sourceUserId, targetUserId, signal);
  }
  async getActiveDelegations(targetUserId: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation[]> {
    const now = this.clock.now;
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", targetUserId).where((x) => x.isActiveAt(now)).toList(signal);
  }
  findActiveDelegationById(id: Guid, signal?: AbortSignal): Promise<IdentityUserDelegation | undefined> {
    return this.queries.findActiveDelegationById(id, signal);
  }
}
