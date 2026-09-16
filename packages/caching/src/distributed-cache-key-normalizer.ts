import { Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpDistributedCacheOptions } from "./abp-distributed-cache-options.js";

/** Port of `DistributedCacheKeyNormalizeArgs`. */
export class DistributedCacheKeyNormalizeArgs {
  constructor(
    readonly key: string,
    readonly cacheName: string,
    readonly ignoreMultiTenancy: boolean,
  ) {}
}

/** Port of `IDistributedCacheKeyNormalizer`. */
export interface IDistributedCacheKeyNormalizer {
  normalizeKey(args: DistributedCacheKeyNormalizeArgs): string;
}
export const IDistributedCacheKeyNormalizer = createToken<IDistributedCacheKeyNormalizer>("IDistributedCacheKeyNormalizer");

/** Port of `DistributedCacheKeyNormalizer`: `t:{tenantId},c:{cacheName},k:{prefix}{key}`. */
@Transient(IDistributedCacheKeyNormalizer)
export class DistributedCacheKeyNormalizer implements IDistributedCacheKeyNormalizer {
  static readonly inject = [ICurrentTenant, optionsToken(AbpDistributedCacheOptions)] as const;
  protected readonly distributedCacheOptions: AbpDistributedCacheOptions;

  constructor(
    protected readonly currentTenant: ICurrentTenant,
    distributedCacheOptions: IOptions<AbpDistributedCacheOptions>,
  ) {
    this.distributedCacheOptions = distributedCacheOptions.value;
  }

  normalizeKey(args: DistributedCacheKeyNormalizeArgs): string {
    let normalizedKey = `c:${args.cacheName},k:${this.distributedCacheOptions.keyPrefix}${args.key}`;
    if (!args.ignoreMultiTenancy && this.currentTenant.id !== undefined) {
      normalizedKey = `t:${this.currentTenant.id},${normalizedKey}`;
    }
    return normalizedKey;
  }
}
