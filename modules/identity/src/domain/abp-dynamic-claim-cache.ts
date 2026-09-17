import { distributedCacheToken } from "@abp/caching";
import { AbpDynamicClaimCacheItem } from "@abp/security";

/** The `IDistributedCache<AbpDynamicClaimCacheItem>` token used by the identity managers to invalidate dynamic claims. */
export const IAbpDynamicClaimCache = distributedCacheToken(AbpDynamicClaimCacheItem);
