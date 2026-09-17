import { ILoggerFactory, Transient, optionsToken, type Guid, type ILogger, type IOptions } from "@abp/core";
import { DistributedCacheEntryOptions, type IDistributedCache } from "@abp/caching";
import { EntityNotFoundException } from "@abp/ddd-domain";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimsPrincipalFactoryOptions, AbpDynamicClaim, AbpDynamicClaimCacheItem, AbpDynamicClaimsPrincipalContributorBase, ClaimsIdentity, ClaimsPrincipal, findTenantId, findUserId, type AbpClaimsPrincipalContributorContext } from "@abp/security";
import { IAbpDynamicClaimCache } from "./abp-dynamic-claim-cache.js";
import { AbpUserClaimsPrincipalFactory } from "./abp-user-claims-principal-factory.js";
import { IdentityDynamicClaimsPrincipalContributorCacheOptions } from "./identity-options.js";
import { IdentityUserManager } from "./identity-user-manager.js";

/** Port of `IdentityDynamicClaimsPrincipalContributorCache`: the dynamic claims of a user, cached for an hour. */
@Transient()
export class IdentityDynamicClaimsPrincipalContributorCache {
  static readonly inject = [IAbpDynamicClaimCache, ICurrentTenant, IdentityUserManager, AbpUserClaimsPrincipalFactory, optionsToken(AbpClaimsPrincipalFactoryOptions), optionsToken(IdentityDynamicClaimsPrincipalContributorCacheOptions), ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly dynamicClaimCache: IDistributedCache<AbpDynamicClaimCacheItem>,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly userManager: IdentityUserManager,
    protected readonly userClaimsPrincipalFactory: AbpUserClaimsPrincipalFactory,
    protected readonly abpClaimsPrincipalFactoryOptions: IOptions<AbpClaimsPrincipalFactoryOptions>,
    protected readonly cacheOptions: IOptions<IdentityDynamicClaimsPrincipalContributorCacheOptions>,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(IdentityDynamicClaimsPrincipalContributorCache.name);
  }

  async get(userId: Guid, tenantId?: Guid): Promise<AbpDynamicClaimCacheItem> {
    this.logger.debug(`Get dynamic claims cache for user: ${userId}`);
    const entryOptions = () => new DistributedCacheEntryOptions({ absoluteExpirationRelativeToNow: this.cacheOptions.value.cacheAbsoluteExpirationMs });
    const dynamicClaimTypes = this.abpClaimsPrincipalFactoryOptions.value.dynamicClaims;
    if (dynamicClaimTypes.length === 0) {
      const emptyCacheItem = new AbpDynamicClaimCacheItem();
      await this.dynamicClaimCache.set(AbpDynamicClaimCacheItem.calculateCacheKey(userId, tenantId), emptyCacheItem, entryOptions());
      return emptyCacheItem;
    }

    return this.currentTenant.run(tenantId, undefined, async () => {
      const item = await this.dynamicClaimCache.getOrAdd(
        AbpDynamicClaimCacheItem.calculateCacheKey(userId, tenantId),
        async () => {
          this.logger.debug(`Filling dynamic claims cache for user: ${userId}`);
          const user = await this.userManager.getById(userId);
          const principal = await this.userClaimsPrincipalFactory.create(user);
          const dynamicClaims = new AbpDynamicClaimCacheItem();
          for (const claimType of dynamicClaimTypes) {
            const claims = principal.claims.filter((x) => x.type === claimType);
            if (claims.length > 0) dynamicClaims.claims.push(...claims.map((claim) => new AbpDynamicClaim(claimType, claim.value)));
            else dynamicClaims.claims.push(new AbpDynamicClaim(claimType, undefined));
          }
          return dynamicClaims;
        },
        entryOptions,
      );
      return item ?? new AbpDynamicClaimCacheItem();
    });
  }

  async clear(userId: Guid, tenantId?: Guid): Promise<void> {
    this.logger.debug(`Remove dynamic claims cache for user: ${userId}`);
    await this.dynamicClaimCache.remove(AbpDynamicClaimCacheItem.calculateCacheKey(userId, tenantId));
  }
}

/** Port of `IdentityDynamicClaimsPrincipalContributor`: refreshes the dynamic claims of the principal from the identity store. */
@Transient()
export class IdentityDynamicClaimsPrincipalContributor extends AbpDynamicClaimsPrincipalContributorBase {
  override async contribute(context: AbpClaimsPrincipalContributorContext): Promise<void> {
    const identity = context.claimsPrincipal.identities[0];
    const userId = identity === undefined ? undefined : findUserId(identity);
    if (identity === undefined || userId === undefined) return;

    const dynamicClaimsCache = context.getRequiredService(IdentityDynamicClaimsPrincipalContributorCache);
    let dynamicClaims: AbpDynamicClaimCacheItem;
    try {
      dynamicClaims = await dynamicClaimsCache.get(userId, findTenantId(identity));
    } catch (e) {
      if (!(e instanceof EntityNotFoundException)) throw e;
      /* The user no longer exists: the principal is cleared, like .NET. */
      context.claimsPrincipal = new ClaimsPrincipal(new ClaimsIdentity());
      context.getRequiredService(ILoggerFactory).createLogger(IdentityDynamicClaimsPrincipalContributor.name).warn(`User not found: ${userId}`, undefined, e);
      return;
    }
    if (dynamicClaims.claims.length === 0) return;
    await this.addDynamicClaims(context, identity, dynamicClaims.claims);
  }
}
