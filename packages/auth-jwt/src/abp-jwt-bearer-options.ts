import { AbpClaimTypes } from "@abp/security";
import { createHash, timingSafeEqual } from "node:crypto";
import type { JSONWebKeySet } from "jose";

/** How tokens are signed/verified (port of `TokenValidationParameters.IssuerSigningKey` + OpenIddict signing credentials). */
export type JwtSigningOptions =
  | { readonly kind: "hmac"; readonly secret?: string }
  | { readonly kind: "rsa"; readonly privateKeyPem?: string; readonly publicKeyPem?: string }
  | { readonly kind: "jwks"; readonly jwksUri?: string; readonly jwks?: JSONWebKeySet };

/** Port of the relevant `JwtBearerOptions` + OpenIddict server options. Bound from `Abp:Auth:Jwt` by the module. */
export class AbpJwtBearerOptions {
  /** Authentication scheme name (`JwtBearerDefaults.AuthenticationScheme`). */
  scheme = "Bearer";
  issuer: string | undefined;
  audience: string | undefined;
  signing: JwtSigningOptions = { kind: "hmac" };
  accessTokenLifetimeSeconds = 60 * 60;
  refreshTokenLifetimeSeconds = 14 * 24 * 60 * 60;
  clockToleranceSeconds = 60;
  /** JWT claim name → ABP claim type (port of `AbpClaimsMapOptions`), including Cognito's names. */
  readonly claimMappings = new Map<string, string>([
    ["sub", AbpClaimTypes.userId],
    ["preferred_username", AbpClaimTypes.userName],
    ["username", AbpClaimTypes.userName],
    ["cognito:username", AbpClaimTypes.userName],
    ["unique_name", AbpClaimTypes.userName],
    ["given_name", AbpClaimTypes.name],
    ["family_name", AbpClaimTypes.surName],
    ["email", AbpClaimTypes.email],
    ["email_verified", AbpClaimTypes.emailVerified],
    ["phone_number", AbpClaimTypes.phoneNumber],
    ["phone_number_verified", AbpClaimTypes.phoneNumberVerified],
    ["role", AbpClaimTypes.role],
    ["roles", AbpClaimTypes.role],
    ["cognito:groups", AbpClaimTypes.role],
    ["tenantid", AbpClaimTypes.tenantId],
    ["client_id", AbpClaimTypes.clientId],
    ["azp", AbpClaimTypes.clientId],
    ["session_id", AbpClaimTypes.sessionId],
    ["picture", AbpClaimTypes.picture],
  ]);
  /** `"memory"` (default) or `"distributed-cache"` (`IDistributedCache<RefreshTokenCacheItem>`, DynamoDB-ready). */
  refreshTokenStore: "memory" | "distributed-cache" = "memory";
}

/** A confidential client for the `client_credentials` grant (and optional client authentication of other grants). */
export interface JwtClientConfiguration {
  readonly clientId: string;
  /** `sha256` hex of the secret; use `hashClientSecret`. Undefined = public client. */
  readonly clientSecretHash?: string;
  readonly displayName?: string;
  /** Default: all grants. */
  readonly allowedGrantTypes?: readonly string[];
  readonly scopes?: readonly string[];
  readonly accessTokenLifetimeSeconds?: number;
}

export function hashClientSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyClientSecret(secret: string, clientSecretHash: string): boolean {
  const a = Buffer.from(hashClientSecret(secret), "hex");
  const b = Buffer.from(clientSecretHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Port of the OpenIddict application store as static configuration. */
export class AbpJwtClientOptions {
  readonly clients: JwtClientConfiguration[] = [];

  addClient(clientId: string, secret: string | undefined, options: Omit<JwtClientConfiguration, "clientId" | "clientSecretHash"> = {}): this {
    this.clients.push({ clientId, clientSecretHash: secret === undefined ? undefined : hashClientSecret(secret), ...options });
    return this;
  }

  findClient(clientId: string): JwtClientConfiguration | undefined {
    return this.clients.find((c) => c.clientId === clientId);
  }
}

/** OAuth 2.0 grant type and error names (port of `OpenIddictConstants`). */
export const OpenIddictConstants = {
  GrantTypes: { Password: "password", RefreshToken: "refresh_token", ClientCredentials: "client_credentials" },
  Errors: { InvalidRequest: "invalid_request", InvalidClient: "invalid_client", InvalidGrant: "invalid_grant", UnauthorizedClient: "unauthorized_client", UnsupportedGrantType: "unsupported_grant_type", InvalidScope: "invalid_scope", ServerError: "server_error" },
} as const;

/** Port of `AbpOpenIddictErrors`. */
export const AbpOpenIddictErrors = {
  AccountLocked: "account_locked",
  AccountInactive: "account_inactive",
} as const;
