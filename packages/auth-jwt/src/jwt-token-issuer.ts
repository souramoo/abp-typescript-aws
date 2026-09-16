import { AbpException, Guid, Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpClaimTypes, Claim, ClaimsPrincipal } from "@abp/security";
import { IClock } from "@abp/timing";
import { SignJWT } from "jose";
import { AbpJwtBearerOptions } from "./abp-jwt-bearer-options.js";
import { claimsToPayload } from "./claims-mapping.js";
import { IRefreshTokenStore, generateRefreshToken, hashRefreshToken, type RefreshTokenEntry } from "./refresh-token-store.js";
import { ISigningKeyProvider } from "./signing-key-provider.js";

export interface IssueTokenOptions {
  /** Access token lifetime; default `AbpJwtBearerOptions.accessTokenLifetimeSeconds`. */
  lifetimeSeconds?: number;
  /** Adds the `tenantid` claim when the principal carries none. */
  tenantId?: string;
  clientId?: string;
  scopes?: readonly string[];
  /** Default: true. */
  includeRefreshToken?: boolean;
}

/** OAuth 2.0 token response (snake_case on the wire). */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly refreshToken: string | undefined;
  readonly scope: string | undefined;
}

export type RefreshResult = { readonly kind: "success"; readonly tokens: IssuedTokens; readonly claims: readonly Claim[] } | { readonly kind: "invalid"; readonly reason: string };

/** Port of the OpenIddict token issuance (`SignIn` results): access tokens as JWTs, refresh tokens as opaque rotated strings. */
export interface IJwtTokenIssuer {
  issue(principalOrClaims: ClaimsPrincipal | Iterable<Claim>, options?: IssueTokenOptions): Promise<IssuedTokens>;
  /** Rotates the refresh token: the old one is consumed, a new pair is issued from the stored claims. */
  refresh(refreshToken: string, options?: Pick<IssueTokenOptions, "lifetimeSeconds" | "clientId">): Promise<RefreshResult>;
  revoke(refreshToken: string): Promise<void>;
}
export const IJwtTokenIssuer = createToken<IJwtTokenIssuer>("IJwtTokenIssuer");

@Transient(IJwtTokenIssuer)
export class JwtTokenIssuer implements IJwtTokenIssuer {
  static readonly inject = [optionsToken(AbpJwtBearerOptions), ISigningKeyProvider, IRefreshTokenStore, IClock] as const;
  protected readonly options: AbpJwtBearerOptions;

  constructor(
    options: IOptions<AbpJwtBearerOptions>,
    protected readonly signingKeyProvider: ISigningKeyProvider,
    protected readonly refreshTokenStore: IRefreshTokenStore,
    protected readonly clock: IClock,
  ) {
    this.options = options.value;
  }

  async issue(principalOrClaims: ClaimsPrincipal | Iterable<Claim>, options: IssueTokenOptions = {}): Promise<IssuedTokens> {
    const claims = [...(principalOrClaims instanceof ClaimsPrincipal ? principalOrClaims.claims : principalOrClaims)];
    if (options.tenantId !== undefined && !claims.some((c) => c.type === AbpClaimTypes.tenantId)) claims.push(new Claim(AbpClaimTypes.tenantId, options.tenantId));
    if (options.clientId !== undefined && !claims.some((c) => c.type === AbpClaimTypes.clientId)) claims.push(new Claim(AbpClaimTypes.clientId, options.clientId));

    const lifetime = options.lifetimeSeconds ?? this.options.accessTokenLifetimeSeconds;
    const now = Math.floor(this.clock.now.getTime() / 1000);
    const payload = claimsToPayload(claims);
    if (options.scopes && options.scopes.length > 0) payload["scope"] = options.scopes.join(" ");

    const jwt = new SignJWT(payload).setIssuedAt(now).setExpirationTime(now + lifetime).setJti(Guid.newGuid());
    if (this.options.issuer) jwt.setIssuer(this.options.issuer);
    if (this.options.audience) jwt.setAudience(this.options.audience);

    const key = await this.signingKeyProvider.getSigningKey();
    let accessToken: string;
    switch (key.kind) {
      case "hmac":
        accessToken = await jwt.setProtectedHeader({ alg: key.algorithm, typ: "JWT" }).sign(key.secret);
        break;
      case "rsa":
        if (!key.privateKey) throw new AbpException("Cannot issue tokens: only an RSA public key is configured.");
        accessToken = await jwt.setProtectedHeader({ alg: key.algorithm, typ: "JWT", kid: key.kid }).sign(key.privateKey);
        break;
      case "jwks":
        throw new AbpException("Cannot issue tokens with a JWKS (external identity provider) configuration.");
      default: {
        const _exhaustive: never = key;
        throw new AbpException(`Unknown key ${String(_exhaustive)}`);
      }
    }

    const refreshToken = options.includeRefreshToken === false ? undefined : await this.storeRefreshToken(claims, options);
    return { accessToken, tokenType: "Bearer", expiresIn: lifetime, refreshToken, scope: options.scopes && options.scopes.length > 0 ? options.scopes.join(" ") : undefined };
  }

  async refresh(refreshToken: string, options: Pick<IssueTokenOptions, "lifetimeSeconds" | "clientId"> = {}): Promise<RefreshResult> {
    const hash = hashRefreshToken(refreshToken);
    const entry = await this.refreshTokenStore.get(hash);
    if (!entry) return { kind: "invalid", reason: "The refresh token is invalid or has expired." };
    if (new Date(entry.expiresAt).getTime() <= this.clock.now.getTime()) {
      await this.refreshTokenStore.remove(hash);
      return { kind: "invalid", reason: "The refresh token has expired." };
    }
    if (options.clientId !== undefined && entry.clientId !== undefined && entry.clientId !== options.clientId) return { kind: "invalid", reason: "The refresh token was issued to another client." };

    await this.refreshTokenStore.remove(hash);
    const claims = entry.claims.map((c) => new Claim(c.type, c.value));
    const tokens = await this.issue(claims, { lifetimeSeconds: options.lifetimeSeconds, tenantId: entry.tenantId, clientId: entry.clientId, scopes: entry.scopes });
    return { kind: "success", tokens, claims };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.refreshTokenStore.remove(hashRefreshToken(refreshToken));
  }

  private async storeRefreshToken(claims: readonly Claim[], options: IssueTokenOptions): Promise<string> {
    const token = generateRefreshToken();
    const ttl = this.options.refreshTokenLifetimeSeconds;
    const entry: RefreshTokenEntry = {
      claims: claims.map((c) => ({ type: c.type, value: c.value })),
      tenantId: options.tenantId ?? claims.find((c) => c.type === AbpClaimTypes.tenantId)?.value,
      clientId: options.clientId ?? claims.find((c) => c.type === AbpClaimTypes.clientId)?.value,
      scopes: [...(options.scopes ?? [])],
      expiresAt: new Date(this.clock.now.getTime() + ttl * 1000).toISOString(),
    };
    await this.refreshTokenStore.set(hashRefreshToken(token), entry, ttl);
    return token;
  }
}
