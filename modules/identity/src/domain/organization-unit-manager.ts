import { AbpException, BusinessException, Check, Transient, type Guid } from "@abp/core";
import type { IDistributedCache } from "@abp/caching";
import { DomainService } from "@abp/ddd-domain";
import { AbpDynamicClaimCacheItem } from "@abp/security";
import { UnitOfWork } from "@abp/uow";
import { IdentityErrorCodes } from "../domain-shared/index.js";
import { IAbpDynamicClaimCache } from "./abp-dynamic-claim-cache.js";
import type { IdentityRole } from "./identity-role.js";
import type { IdentityUser } from "./identity-user.js";
import { OrganizationUnit } from "./organization-unit.js";
import { IIdentityRoleRepository, IOrganizationUnitRepository } from "./repositories.js";

/** Port of `OrganizationUnitManager`: creates, moves and deletes OUs keeping their hierarchical codes consistent. */
@Transient()
export class OrganizationUnitManager extends DomainService {
  static readonly inject = [IOrganizationUnitRepository, IIdentityRoleRepository, IAbpDynamicClaimCache] as const;

  constructor(
    protected readonly organizationUnitRepository: IOrganizationUnitRepository,
    protected readonly identityRoleRepository: IIdentityRoleRepository,
    protected readonly dynamicClaimCache: IDistributedCache<AbpDynamicClaimCacheItem>,
  ) {
    super();
  }

  @UnitOfWork()
  async create(organizationUnit: OrganizationUnit): Promise<void> {
    await this.validateParentTenant(organizationUnit.parentId, organizationUnit.tenantId);
    organizationUnit.code = await this.getNextChildCode(organizationUnit.parentId);
    await this.validateOrganizationUnit(organizationUnit);
    await this.organizationUnitRepository.insert(organizationUnit);
  }

  @UnitOfWork()
  async createMany(organizationUnits: OrganizationUnit[]): Promise<void> {
    Check.notNull(organizationUnits, "organizationUnits");
    if (organizationUnits.some((x) => (x.tenantId ?? undefined) !== this.currentTenant.id)) {
      throw new AbpException("Organization units of another tenant can not be created, change the current tenant instead!");
    }
    const groups = new Map<Guid | undefined, OrganizationUnit[]>();
    for (const organizationUnit of organizationUnits) groups.set(organizationUnit.parentId, [...(groups.get(organizationUnit.parentId) ?? []), organizationUnit]);
    for (const [parentId, group] of groups) {
      await this.validateParentTenant(parentId, this.currentTenant.id);
      const siblings = await this.findChildren(parentId);
      let lastCode: string | undefined;
      for (const organizationUnit of group) {
        organizationUnit.code = lastCode = lastCode === undefined ? await this.getNextChildCode(parentId) : OrganizationUnit.calculateNextCode(lastCode);
        await this.validateOrganizationUnitAgainst(organizationUnit, siblings);
        siblings.push(organizationUnit);
      }
    }
    for (const group of groups.values()) await this.organizationUnitRepository.insertMany(group);
  }

  async update(organizationUnit: OrganizationUnit): Promise<void> {
    await this.validateOrganizationUnit(organizationUnit);
    await this.organizationUnitRepository.update(organizationUnit);
    await this.removeDynamicClaimCache(organizationUnit);
  }

  async getNextChildCode(parentId: Guid | undefined): Promise<string> {
    const lastChild = await this.getLastChildOrNull(parentId);
    if (lastChild) return OrganizationUnit.calculateNextCode(lastChild.code);
    const parentCode = parentId !== undefined ? await this.getCodeOrDefault(parentId) : undefined;
    return OrganizationUnit.appendCode(parentCode, OrganizationUnit.createCode(1));
  }

  async getLastChildOrNull(parentId: Guid | undefined): Promise<OrganizationUnit | undefined> {
    const children = await this.organizationUnitRepository.getChildren(parentId);
    return [...children].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)).at(-1);
  }

  @UnitOfWork()
  async delete(id: Guid): Promise<void> {
    const children = await this.findChildren(id, true);
    for (const child of children) {
      await this.removeDynamicClaimCache(child);
      await this.organizationUnitRepository.removeAllMembers(child);
      await this.organizationUnitRepository.removeAllRoles(child);
      await this.organizationUnitRepository.delete(child);
    }
    const organizationUnit = await this.organizationUnitRepository.get(id);
    await this.removeDynamicClaimCache(organizationUnit);
    await this.organizationUnitRepository.removeAllMembers(organizationUnit);
    await this.organizationUnitRepository.removeAllRoles(organizationUnit);
    await this.organizationUnitRepository.deleteById(id);
  }

  @UnitOfWork()
  async move(id: Guid, parentId: Guid | undefined): Promise<void> {
    const organizationUnit = await this.organizationUnitRepository.get(id);
    if ((organizationUnit.parentId ?? undefined) === (parentId ?? undefined)) return;
    await this.validateParentTenant(parentId, organizationUnit.tenantId);
    const children = await this.findChildren(id, true);
    const oldCode = organizationUnit.code;
    organizationUnit.code = await this.getNextChildCode(parentId);
    organizationUnit.parentId = parentId;
    await this.validateOrganizationUnit(organizationUnit);
    for (const child of children) {
      child.code = OrganizationUnit.appendCode(organizationUnit.code, OrganizationUnit.getRelativeCode(child.code, oldCode));
      await this.organizationUnitRepository.update(child);
    }
    await this.organizationUnitRepository.update(organizationUnit);
  }

  async getCodeOrDefault(id: Guid): Promise<string | undefined> {
    return (await this.organizationUnitRepository.find(id))?.code;
  }

  protected async validateOrganizationUnit(organizationUnit: OrganizationUnit): Promise<void> {
    await this.validateOrganizationUnitAgainst(organizationUnit, await this.findChildren(organizationUnit.parentId));
  }

  protected async validateOrganizationUnitAgainst(organizationUnit: OrganizationUnit, siblings: readonly OrganizationUnit[]): Promise<void> {
    if (siblings.some((ou) => ou.id !== organizationUnit.id && ou.displayName === organizationUnit.displayName)) {
      throw new BusinessException({ code: IdentityErrorCodes.DuplicateOrganizationUnitDisplayName }).withData("0", organizationUnit.displayName);
    }
  }

  protected async validateParentTenant(parentId: Guid | undefined, tenantId: Guid | undefined): Promise<void> {
    if (parentId === undefined) return;
    const parent = await this.organizationUnitRepository.find(parentId);
    if (!parent || (parent.tenantId ?? undefined) !== (tenantId ?? undefined)) {
      throw new BusinessException({ code: IdentityErrorCodes.OrganizationUnitParentTenantMismatch }).withData("ParentId", parentId);
    }
  }

  async findChildren(parentId: Guid | undefined, recursive = false): Promise<OrganizationUnit[]> {
    if (!recursive) return this.organizationUnitRepository.getChildren(parentId, true);
    if (parentId === undefined) return this.organizationUnitRepository.getList(true);
    const code = await this.getCodeOrDefault(parentId);
    return this.organizationUnitRepository.getAllChildrenWithParentCode(code ?? "", parentId, true);
  }

  async isInOrganizationUnit(user: IdentityUser, ou: OrganizationUnit): Promise<boolean> {
    return user.isInOrganizationUnit(ou.id);
  }

  async addRoleToOrganizationUnit(roleOrId: IdentityRole | Guid, organizationUnitOrId: OrganizationUnit | Guid): Promise<void> {
    const role = typeof roleOrId === "string" ? await this.identityRoleRepository.get(roleOrId) : roleOrId;
    const ou = typeof organizationUnitOrId === "string" ? await this.organizationUnitRepository.get(organizationUnitOrId, true) : organizationUnitOrId;
    if (ou.roles.some((r) => r.organizationUnitId === ou.id && r.roleId === role.id)) return;
    ou.addRole(role.id);
    await this.organizationUnitRepository.update(ou);
    await this.removeDynamicClaimCache(ou);
  }

  async removeRoleFromOrganizationUnit(roleOrId: IdentityRole | Guid, organizationUnitOrId: OrganizationUnit | Guid): Promise<void> {
    const role = typeof roleOrId === "string" ? await this.identityRoleRepository.get(roleOrId) : roleOrId;
    const organizationUnit = typeof organizationUnitOrId === "string" ? await this.organizationUnitRepository.get(organizationUnitOrId, true) : organizationUnitOrId;
    organizationUnit.removeRole(role.id);
    await this.organizationUnitRepository.update(organizationUnit);
    await this.removeDynamicClaimCache(organizationUnit);
  }

  async removeDynamicClaimCache(organizationUnit: OrganizationUnit): Promise<void> {
    this.logger.debug(`Remove dynamic claims cache for users of organization: ${organizationUnit.id}`);
    const userIds = await this.organizationUnitRepository.getMemberIds(organizationUnit.id);
    if (userIds.length === 0) return;
    await this.dynamicClaimCache.removeMany(userIds.map((userId) => AbpDynamicClaimCacheItem.calculateCacheKey(userId, organizationUnit.tenantId)));
  }
}
