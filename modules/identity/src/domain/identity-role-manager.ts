import { BusinessException, Check, IServiceProviderToken, Transient, type Guid, type IServiceProvider } from "@abp/core";
import type { IDistributedCache } from "@abp/caching";
import { AbpDbConcurrencyException } from "@abp/data";
import { DomainService, EntityNotFoundException } from "@abp/ddd-domain";
import { AbpDynamicClaimCacheItem } from "@abp/security";
import { IdentityErrorCodes } from "../domain-shared/index.js";
import { AbpIdentityErrorDescriber } from "./abp-identity-error-describer.js";
import { IAbpDynamicClaimCache } from "./abp-dynamic-claim-cache.js";
import { ILookupNormalizer } from "./identity-options.js";
import { IdentityResult } from "./identity-result.js";
import type { IdentityRole } from "./identity-role.js";
import { OrganizationUnitManager } from "./organization-unit-manager.js";
import { IIdentityRoleRepository, IIdentityUserRepository, IOrganizationUnitRepository } from "./repositories.js";
import { IRoleValidator, type IRoleManagerForValidation } from "./validators.js";

/**
 * Port of `IdentityRoleManager` together with the `RoleManager<TRole>` / `IdentityRoleStore` members ABP relies on.
 * Renaming a role goes through `IdentityRole.changeName`, which records the `IdentityRoleNameChangedEto`; the
 * permission grants of the old name are moved by `RoleUpdateEventHandler`.
 */
@Transient()
export class IdentityRoleManager extends DomainService implements IRoleManagerForValidation {
  static readonly inject = [IIdentityRoleRepository, IIdentityUserRepository, IOrganizationUnitRepository, OrganizationUnitManager, ILookupNormalizer, AbpIdentityErrorDescriber, IServiceProviderToken, IAbpDynamicClaimCache] as const;

  constructor(
    protected readonly roleRepository: IIdentityRoleRepository,
    protected readonly userRepository: IIdentityUserRepository,
    protected readonly organizationUnitRepository: IOrganizationUnitRepository,
    protected readonly organizationUnitManager: OrganizationUnitManager,
    protected readonly keyNormalizer: ILookupNormalizer,
    readonly errorDescriber: AbpIdentityErrorDescriber,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly dynamicClaimCache: IDistributedCache<AbpDynamicClaimCacheItem>,
  ) {
    super();
  }

  normalizeKey(key: string | undefined): string | undefined {
    return this.keyNormalizer.normalizeName(key);
  }

  async findById(id: Guid): Promise<IdentityRole | undefined> {
    return this.roleRepository.find(id);
  }

  async getById(id: Guid): Promise<IdentityRole> {
    const role = await this.findById(id);
    if (!role) throw new EntityNotFoundException(this.roleRepository.entityType, id);
    return role;
  }

  async findByName(roleName: string): Promise<IdentityRole | undefined> {
    Check.notNull(roleName, "roleName");
    return this.roleRepository.findByNormalizedName(this.normalizeKey(roleName) ?? roleName.toUpperCase());
  }

  async roleExists(roleName: string): Promise<boolean> {
    return (await this.findByName(roleName)) !== undefined;
  }

  /** Port of `RoleManager.CreateAsync`. */
  async create(role: IdentityRole): Promise<IdentityResult> {
    Check.notNull(role, "role");
    const validation = await this.validateRole(role);
    if (!validation.succeeded) return validation;
    this.updateNormalizedRoleName(role);
    await this.roleRepository.insert(role, true);
    return IdentityResult.Success;
  }

  /** Port of `RoleManager.UpdateAsync` (`UpdateRoleAsync`). */
  async update(role: IdentityRole): Promise<IdentityResult> {
    Check.notNull(role, "role");
    const validation = await this.validateRole(role);
    if (!validation.succeeded) return validation;
    this.updateNormalizedRoleName(role);
    try {
      await this.roleRepository.update(role, true);
    } catch (e) {
      if (e instanceof AbpDbConcurrencyException) return IdentityResult.failed(this.errorDescriber.concurrencyFailure());
      throw e;
    }
    return IdentityResult.Success;
  }

  /** Port of ABP's `DeleteAsync`: static roles cannot be deleted; the dynamic claims of the affected users are dropped. */
  async delete(role: IdentityRole): Promise<IdentityResult> {
    Check.notNull(role, "role");
    if (role.isStatic) throw new BusinessException({ code: IdentityErrorCodes.StaticRoleDeletion });
    const userIdList = await this.userRepository.getUserIdListByRoleId(role.id);
    const orgList = await this.organizationUnitRepository.getListByRoleId(role.id, false);
    try {
      await this.roleRepository.delete(role, true);
    } catch (e) {
      if (e instanceof AbpDbConcurrencyException) return IdentityResult.failed(this.errorDescriber.concurrencyFailure());
      throw e;
    }
    this.logger.debug(`Remove dynamic claims cache for users of role: ${role.id}`);
    if (userIdList.length > 0) await this.dynamicClaimCache.removeMany(userIdList.map((userId) => AbpDynamicClaimCacheItem.calculateCacheKey(userId, role.tenantId)));
    for (const organizationUnit of orgList) await this.organizationUnitManager.removeDynamicClaimCache(organizationUnit);
    return IdentityResult.Success;
  }

  /** Port of ABP's `SetRoleNameAsync`: renames (static roles cannot be renamed) without persisting; call `update` afterwards. */
  async setRoleName(role: IdentityRole, name: string): Promise<IdentityResult> {
    Check.notNull(role, "role");
    if (role.isStatic && role.name !== name) throw new BusinessException({ code: IdentityErrorCodes.StaticRoleRenaming });
    const userIdList = await this.userRepository.getUserIdListByRoleId(role.id);
    role.changeName(name);
    this.updateNormalizedRoleName(role);
    this.logger.debug(`Remove dynamic claims cache for users of role: ${role.id}`);
    if (userIdList.length > 0) await this.dynamicClaimCache.removeMany(userIdList.map((userId) => AbpDynamicClaimCacheItem.calculateCacheKey(userId, role.tenantId)));
    return IdentityResult.Success;
  }

  protected updateNormalizedRoleName(role: IdentityRole): void {
    role.normalizedName = this.normalizeKey(role.name) ?? role.name.toUpperCase();
  }

  protected async validateRole(role: IdentityRole): Promise<IdentityResult> {
    const errors = [];
    for (const validator of this.serviceProvider.getAll(IRoleValidator)) {
      const result = await validator.validate(this, role);
      if (!result.succeeded) errors.push(...result.errors);
    }
    if (errors.length > 0) {
      this.logger.warn(`Role validation failed: ${errors.map((e) => e.code).join(";")}.`);
      return IdentityResult.failed(...errors);
    }
    return IdentityResult.Success;
  }
}
