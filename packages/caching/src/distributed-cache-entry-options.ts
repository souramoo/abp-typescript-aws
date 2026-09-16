import { ArgumentException } from "@abp/core";

/** Port of `Microsoft.Extensions.Caching.Distributed.DistributedCacheEntryOptions`; durations are milliseconds. */
export class DistributedCacheEntryOptions {
  private absolute: Date | undefined;
  private relative: number | undefined;
  private sliding: number | undefined;

  constructor(init: Partial<Pick<DistributedCacheEntryOptions, "absoluteExpiration" | "absoluteExpirationRelativeToNow" | "slidingExpiration">> = {}) {
    if (init.absoluteExpiration !== undefined) this.absoluteExpiration = init.absoluteExpiration;
    if (init.absoluteExpirationRelativeToNow !== undefined) this.absoluteExpirationRelativeToNow = init.absoluteExpirationRelativeToNow;
    if (init.slidingExpiration !== undefined) this.slidingExpiration = init.slidingExpiration;
  }

  /** An absolute expiration date for the cache entry. */
  get absoluteExpiration(): Date | undefined {
    return this.absolute;
  }
  set absoluteExpiration(value: Date | undefined) {
    this.absolute = value;
  }

  /** An absolute expiration time, relative to now (milliseconds). */
  get absoluteExpirationRelativeToNow(): number | undefined {
    return this.relative;
  }
  set absoluteExpirationRelativeToNow(value: number | undefined) {
    if (value !== undefined && value <= 0) throw new ArgumentException("The relative expiration value must be positive.", "absoluteExpirationRelativeToNow");
    this.relative = value;
  }

  /** How long an entry can be inactive (not accessed) before it is removed (milliseconds). */
  get slidingExpiration(): number | undefined {
    return this.sliding;
  }
  set slidingExpiration(value: number | undefined) {
    if (value !== undefined && value <= 0) throw new ArgumentException("The sliding expiration value must be positive.", "slidingExpiration");
    this.sliding = value;
  }

  clone(): DistributedCacheEntryOptions {
    return new DistributedCacheEntryOptions({ absoluteExpiration: this.absolute, absoluteExpirationRelativeToNow: this.relative, slidingExpiration: this.sliding });
  }
}
