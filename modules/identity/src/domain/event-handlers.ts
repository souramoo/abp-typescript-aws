import { ILoggerFactory, Transient, type ILogger } from "@abp/core";
import type { IDistributedCache } from "@abp/caching";
import { RolePermissionValueProvider } from "@abp/authorization";
import { EntityDeletedEto, EntityDeletedEventData, EntityUpdatedEventData } from "@abp/ddd-domain";
import { DistributedEventHandler, LocalEventHandler, type IDistributedEventHandler, type ILocalEventHandler } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IPermissionGrantRepository, IPermissionManager } from "@abp/permission-management/domain";
import { AbpDynamicClaimCacheItem } from "@abp/security";
import { UnitOfWork } from "@abp/uow";
import { IdentityRoleEto, IdentityRoleNameChangedEto } from "../domain-shared/index.js";
import { IAbpDynamicClaimCache } from "./abp-dynamic-claim-cache.js";
import { IdentityLinkUserInfo } from "./identity-link-user.js";
import { IdentityUser } from "./identity-user.js";
import { IIdentityLinkUserRepository, IIdentitySessionRepository, IIdentityUserDelegationRepository } from "./repositories.js";

/** Port of `UserDeletedEventHandler` (identity domain): sessions, delegations and link users have no navigation from the user. */
@Transient()
@LocalEventHandler(EntityDeletedEventData.of(IdentityUser))
export class UserDeletedEventHandler implements ILocalEventHandler<EntityDeletedEventData<IdentityUser>> {
  static readonly inject = [IIdentitySessionRepository, IIdentityUserDelegationRepository, IIdentityLinkUserRepository, ICurrentTenant] as const;

  constructor(
    protected readonly identitySessionRepository: IIdentitySessionRepository,
    protected readonly identityUserDelegationRepository: IIdentityUserDelegationRepository,
    protected readonly identityLinkUserRepository: IIdentityLinkUserRepository,
    protected readonly currentTenant: ICurrentTenant,
  ) {}

  @UnitOfWork()
  async handleEvent(eventData: EntityDeletedEventData<IdentityUser>): Promise<void> {
    const user = eventData.entity;
    await this.identitySessionRepository.deleteAllOfUser(user.id);
    const delegations = [...(await this.identityUserDelegationRepository.getListOf(user.id, undefined)), ...(await this.identityUserDelegationRepository.getListOf(undefined, user.id))];
    const distinct = [...new Map(delegations.map((d) => [d.id, d])).values()];
    await this.identityUserDelegationRepository.deleteMany(distinct);
    await this.currentTenant.run(undefined, undefined, () => this.identityLinkUserRepository.deleteAllOf(new IdentityLinkUserInfo(user.id, user.tenantId)));
  }
}

/** Port of `UserEntityUpdatedOrDeletedEventHandler`: drops the dynamic claims cache of a changed user. */
@Transient()
@LocalEventHandler(EntityUpdatedEventData.of(IdentityUser), EntityDeletedEventData.of(IdentityUser))
export class UserEntityUpdatedOrDeletedEventHandler implements ILocalEventHandler<EntityUpdatedEventData<IdentityUser> | EntityDeletedEventData<IdentityUser>> {
  static readonly inject = [IAbpDynamicClaimCache, ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly dynamicClaimCache: IDistributedCache<AbpDynamicClaimCacheItem>,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(UserEntityUpdatedOrDeletedEventHandler.name);
  }

  @UnitOfWork()
  async handleEvent(eventData: EntityUpdatedEventData<IdentityUser> | EntityDeletedEventData<IdentityUser>): Promise<void> {
    this.logger.debug(`Remove dynamic claims cache for user: ${eventData.entity.id}`);
    await this.dynamicClaimCache.remove(AbpDynamicClaimCacheItem.calculateCacheKey(eventData.entity.id, eventData.entity.tenantId));
  }
}

/**
 * Port of `RoleDeletedEventHandler` (`Volo.Abp.PermissionManagement.Domain.Identity`): removes the grants of a
 * deleted role. It lives in the identity module because `AbpPermissionManagementDomainIdentityModule` of this port
 * does not know the identity ETOs (resource permissions are not ported).
 */
@Transient()
@DistributedEventHandler(EntityDeletedEto.of(IdentityRoleEto))
export class RoleDeletedEventHandler implements IDistributedEventHandler<EntityDeletedEto<IdentityRoleEto>> {
  static readonly inject = [IPermissionManager] as const;

  constructor(protected readonly permissionManager: IPermissionManager) {}

  @UnitOfWork()
  async handleEvent(eventData: EntityDeletedEto<IdentityRoleEto>): Promise<void> {
    await this.permissionManager.delete(RolePermissionValueProvider.ProviderName, eventData.entity.name);
  }
}

/** Port of `RoleUpdateEventHandler` (`Volo.Abp.PermissionManagement.Domain.Identity`): moves the grants of a renamed role to the new name. */
@Transient()
@DistributedEventHandler(IdentityRoleNameChangedEto)
export class RoleUpdateEventHandler implements IDistributedEventHandler<IdentityRoleNameChangedEto> {
  static readonly inject = [IPermissionManager, IPermissionGrantRepository] as const;

  constructor(
    protected readonly permissionManager: IPermissionManager,
    protected readonly permissionGrantRepository: IPermissionGrantRepository,
  ) {}

  @UnitOfWork()
  async handleEvent(eventData: IdentityRoleNameChangedEto): Promise<void> {
    const permissionGrantsInRole = await this.permissionGrantRepository.getListByProvider(RolePermissionValueProvider.ProviderName, eventData.oldName);
    for (const permissionGrant of permissionGrantsInRole) await this.permissionManager.updateProviderKey(permissionGrant, eventData.name);
  }
}
