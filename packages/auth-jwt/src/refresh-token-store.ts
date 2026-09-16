import { Dependency, Singleton, createToken, type Guid } from "@abp/core";
import { CacheName, DistributedCacheEntryOptions, distributedCacheToken, type IDistributedCache } from "@abp/caching";
import { IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { createHash, randomBytes } from "node:crypto";

/** What a refresh token remembers about the session it renews. */
export interface RefreshTokenEntry {
  readonly claims: readonly { readonly type: string; readonly value: string }[];
  readonly tenantId: Guid | undefined;
  readonly clientId: string | undefined;
  readonly scopes: readonly string[];
  /** ISO instant. */
  readonly expiresAt: string;
}

/** Port of the OpenIddict token store, reduced to refresh tokens keyed by the token hash (raw tokens are never stored). */
export interface IRefreshTokenStore {
  get(tokenHash: string): Promise<RefreshTokenEntry | undefined>;
  set(tokenHash: string, entry: RefreshTokenEntry, ttlSeconds: number): Promise<void>;
  remove(tokenHash: string): Promise<void>;
}
export const IRefreshTokenStore = createToken<IRefreshTokenStore>("IRefreshTokenStore");

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

/** Default store: process memory (fine for a single Lambda container / tests, not shared across containers). */
@Dependency({ tryRegister: true })
@Singleton(IRefreshTokenStore)
export class InMemoryRefreshTokenStore implements IRefreshTokenStore {
  private readonly entries = new Map<string, { entry: RefreshTokenEntry; expiresAt: number }>();

  async get(tokenHash: string): Promise<RefreshTokenEntry | undefined> {
    const item = this.entries.get(tokenHash);
    if (!item) return undefined;
    if (item.expiresAt <= Date.now()) {
      this.entries.delete(tokenHash);
      return undefined;
    }
    return item.entry;
  }

  async set(tokenHash: string, entry: RefreshTokenEntry, ttlSeconds: number): Promise<void> {
    this.entries.set(tokenHash, { entry, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async remove(tokenHash: string): Promise<void> {
    this.entries.delete(tokenHash);
  }
}

/** Cache item of the distributed store (tenant-independent: the token endpoint runs before a tenant is known). */
@CacheName("AbpJwtRefreshToken")
@IgnoreMultiTenancy()
export class RefreshTokenCacheItem {
  claims: { type: string; value: string }[] = [];
  tenantId: Guid | undefined;
  clientId: string | undefined;
  scopes: string[] = [];
  expiresAt = "";
}

/** Refresh tokens in `IDistributedCache<RefreshTokenCacheItem>` (select with `AbpJwtBearerOptions.refreshTokenStore = "distributed-cache"`). */
export class DistributedCacheRefreshTokenStore implements IRefreshTokenStore {
  static readonly inject = [distributedCacheToken(RefreshTokenCacheItem)] as const;

  constructor(private readonly cache: IDistributedCache<RefreshTokenCacheItem>) {}

  async get(tokenHash: string): Promise<RefreshTokenEntry | undefined> {
    const item = await this.cache.get(tokenHash);
    if (!item) return undefined;
    if (new Date(item.expiresAt).getTime() <= Date.now()) {
      await this.cache.remove(tokenHash);
      return undefined;
    }
    return { claims: item.claims, tenantId: item.tenantId, clientId: item.clientId, scopes: item.scopes, expiresAt: item.expiresAt };
  }

  async set(tokenHash: string, entry: RefreshTokenEntry, ttlSeconds: number): Promise<void> {
    const item = new RefreshTokenCacheItem();
    item.claims = entry.claims.map((c) => ({ type: c.type, value: c.value }));
    item.tenantId = entry.tenantId;
    item.clientId = entry.clientId;
    item.scopes = [...entry.scopes];
    item.expiresAt = entry.expiresAt;
    await this.cache.set(tokenHash, item, new DistributedCacheEntryOptions({ absoluteExpirationRelativeToNow: ttlSeconds * 1000 }));
  }

  async remove(tokenHash: string): Promise<void> {
    await this.cache.remove(tokenHash);
  }
}
