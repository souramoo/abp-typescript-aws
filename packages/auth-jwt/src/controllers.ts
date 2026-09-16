import { ILoggerFactory, Transient, isNullOrWhiteSpace, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { AbpControllerBase, Controller, DisableAbpFeatures, HttpGet, HttpPost, HttpResult, fromContext, type AbpHttpContext } from "@abp/aws-lambda";
import { HttpStatusCode, MimeTypes } from "@abp/http";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim } from "@abp/security";
import { AbpJwtBearerOptions, AbpJwtClientOptions, OpenIddictConstants, verifyClientSecret, type JwtClientConfiguration } from "./abp-jwt-bearer-options.js";
import { IJwtTokenIssuer, type IssuedTokens } from "./jwt-token-issuer.js";
import { IResourceOwnerPasswordValidator } from "./resource-owner-password-validator.js";
import { ISigningKeyProvider } from "./signing-key-provider.js";

/** Port of `OpenIddictRequest` as read from a form-urlencoded or JSON token request (+ HTTP Basic client credentials). */
export function readTokenRequest(context: AbpHttpContext): Map<string, string> {
  const parameters = new Map<string, string>();
  const request = context.request;
  if (request.hasJsonContentType && request.hasBody) {
    const parsed: unknown = context.jsonSerializer.deserialize(request.body ?? "");
    if (typeof parsed === "object" && parsed !== null) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value !== undefined && value !== null) parameters.set(key, Array.isArray(value) ? value.join(" ") : String(value));
      }
    }
  } else {
    for (const [key, value] of request.form()) parameters.set(key, value);
  }
  const authorization = request.headers.get("authorization");
  const basic = authorization ? /^Basic\s+(.+)$/i.exec(authorization.trim()) : null;
  if (basic?.[1]) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator > 0) {
      parameters.set("client_id", decodeURIComponent(decoded.slice(0, separator)));
      parameters.set("client_secret", decodeURIComponent(decoded.slice(separator + 1)));
    }
  }
  return parameters;
}

function tokenResponse(tokens: IssuedTokens): HttpResult {
  const body: Record<string, unknown> = { access_token: tokens.accessToken, token_type: tokens.tokenType, expires_in: tokens.expiresIn };
  if (tokens.refreshToken) body["refresh_token"] = tokens.refreshToken;
  if (tokens.scope) body["scope"] = tokens.scope;
  return HttpResult.json(body).withHeader("cache-control", "no-store").withHeader("pragma", "no-cache");
}

/** OAuth 2.0 error response (`Forbid(properties, OpenIddictServerAspNetCoreDefaults.AuthenticationScheme)` in .NET). */
export function oauthError(error: string, errorDescription?: string, extra?: Readonly<Record<string, unknown>>, statusCode: number = HttpStatusCode.BadRequest): HttpResult {
  const body: Record<string, unknown> = { error, ...extra };
  if (errorDescription) body["error_description"] = errorDescription;
  const result = HttpResult.json(body, statusCode).withHeader("cache-control", "no-store");
  if (error === OpenIddictConstants.Errors.InvalidClient) result.withHeader("www-authenticate", "Basic");
  return result;
}

type ClientCheck = { readonly kind: "ok"; readonly client: JwtClientConfiguration | undefined } | { readonly kind: "error"; readonly result: HttpResult };

/**
 * Port of OpenIddict's `TokenController` (password, refresh_token and client_credentials grants) and the
 * revocation endpoint. The identity module supplies `IResourceOwnerPasswordValidator`.
 */
@Transient()
@DisableAbpFeatures({ disableUnitOfWork: false, disableAuditing: true, disableMiddleware: false })
@Controller("connect", { isMetadataEnabled: false })
export class TokenController extends AbpControllerBase {
  static readonly inject = [IJwtTokenIssuer, IResourceOwnerPasswordValidator, optionsToken(AbpJwtClientOptions), optionsToken(AbpJwtBearerOptions), ICurrentTenant, ILoggerFactory] as const;
  protected readonly clientOptions: AbpJwtClientOptions;
  protected readonly jwtOptions: AbpJwtBearerOptions;
  protected readonly log: ILogger;

  constructor(
    protected readonly tokenIssuer: IJwtTokenIssuer,
    protected readonly passwordValidator: IResourceOwnerPasswordValidator,
    clientOptions: IOptions<AbpJwtClientOptions>,
    jwtOptions: IOptions<AbpJwtBearerOptions>,
    protected readonly tenant: ICurrentTenant,
    loggerFactory: ILoggerFactory,
  ) {
    super();
    this.clientOptions = clientOptions.value;
    this.jwtOptions = jwtOptions.value;
    this.log = loggerFactory.createLogger(TokenController.name);
  }

  @HttpPost("token", fromContext())
  async handle(context: AbpHttpContext): Promise<HttpResult> {
    const request = readTokenRequest(context);
    const grantType = request.get("grant_type");
    if (isNullOrWhiteSpace(grantType)) return oauthError(OpenIddictConstants.Errors.InvalidRequest, "The 'grant_type' parameter is missing.");

    const client = this.checkClient(request, grantType);
    if (client.kind === "error") return client.result;
    const scopes = (request.get("scope") ?? "").split(/\s+/).filter((s) => s !== "");

    switch (grantType) {
      case OpenIddictConstants.GrantTypes.Password:
        return this.handlePassword(context, request, client.client, scopes);
      case OpenIddictConstants.GrantTypes.RefreshToken:
        return this.handleRefreshToken(request, client.client);
      case OpenIddictConstants.GrantTypes.ClientCredentials:
        return this.handleClientCredentials(client.client, scopes);
      default:
        return oauthError(OpenIddictConstants.Errors.UnsupportedGrantType, `The specified grant type '${grantType}' is not implemented.`);
    }
  }

  /** `POST /connect/revocation`: revokes a refresh token (access tokens are stateless JWTs and expire on their own). */
  @HttpPost("revocation", fromContext())
  async revoke(context: AbpHttpContext): Promise<HttpResult> {
    const request = readTokenRequest(context);
    const token = request.get("token");
    if (isNullOrWhiteSpace(token)) return oauthError(OpenIddictConstants.Errors.InvalidRequest, "The 'token' parameter is missing.");
    const client = this.checkClient(request, "revocation");
    if (client.kind === "error") return client.result;
    await this.tokenIssuer.revoke(token);
    return HttpResult.status(HttpStatusCode.OK).withHeader("cache-control", "no-store");
  }

  protected async handlePassword(context: AbpHttpContext, request: ReadonlyMap<string, string>, client: JwtClientConfiguration | undefined, scopes: readonly string[]): Promise<HttpResult> {
    const userName = request.get("username");
    const password = request.get("password");
    if (isNullOrWhiteSpace(userName) || password === undefined) return oauthError(OpenIddictConstants.Errors.InvalidRequest, "The 'username' and 'password' parameters are required.");

    const result = await this.passwordValidator.validate(userName, password, { tenantId: this.tenant.id, clientId: client?.clientId ?? request.get("client_id"), scopes, httpContext: context, parameters: request });
    if (result.kind === "error") {
      this.log.info(`Authentication failed for username: ${userName}, reason: ${result.error}`);
      if (this.currentUnitOfWork) await this.currentUnitOfWork.rollback();
      return oauthError(result.error, result.errorDescription, result.parameters);
    }

    const claims = [...result.claims];
    const rememberMe = request.get("RememberMe") ?? request.get("remember_me");
    if (rememberMe !== undefined && rememberMe.toLowerCase() === "true") claims.push(new Claim(AbpClaimTypes.rememberMe, "True"));
    const tenantId = claims.find((c) => c.type === AbpClaimTypes.tenantId)?.value ?? this.tenant.id;
    const tokens = await this.tokenIssuer.issue(claims, { tenantId, clientId: client?.clientId, scopes, lifetimeSeconds: client?.accessTokenLifetimeSeconds });
    return tokenResponse(tokens);
  }

  protected async handleRefreshToken(request: ReadonlyMap<string, string>, client: JwtClientConfiguration | undefined): Promise<HttpResult> {
    const refreshToken = request.get("refresh_token");
    if (isNullOrWhiteSpace(refreshToken)) return oauthError(OpenIddictConstants.Errors.InvalidRequest, "The 'refresh_token' parameter is missing.");
    const result = await this.tokenIssuer.refresh(refreshToken, { clientId: client?.clientId, lifetimeSeconds: client?.accessTokenLifetimeSeconds });
    if (result.kind === "invalid") return oauthError(OpenIddictConstants.Errors.InvalidGrant, "The token is no longer valid.");
    return tokenResponse(result.tokens);
  }

  protected async handleClientCredentials(client: JwtClientConfiguration | undefined, scopes: readonly string[]): Promise<HttpResult> {
    if (!client) return oauthError(OpenIddictConstants.Errors.InvalidClient, "The client credentials are required.", undefined, HttpStatusCode.Unauthorized);
    if (client.clientSecretHash === undefined) return oauthError(OpenIddictConstants.Errors.UnauthorizedClient, "Public clients cannot use the client credentials grant.");
    const claims = [new Claim(AbpClaimTypes.userId, client.clientId), new Claim(AbpClaimTypes.userName, client.displayName ?? client.clientId), new Claim(AbpClaimTypes.clientId, client.clientId)];
    const tokens = await this.tokenIssuer.issue(claims, { clientId: client.clientId, scopes, includeRefreshToken: false, lifetimeSeconds: client.accessTokenLifetimeSeconds });
    return tokenResponse(tokens);
  }

  /** OpenIddict validates `client_id`/`client_secret` before the action runs; done here against `AbpJwtClientOptions`. */
  protected checkClient(request: ReadonlyMap<string, string>, grantType: string): ClientCheck {
    const clientId = request.get("client_id");
    if (isNullOrWhiteSpace(clientId)) {
      if (grantType === OpenIddictConstants.GrantTypes.ClientCredentials) return { kind: "error", result: oauthError(OpenIddictConstants.Errors.InvalidClient, "The 'client_id' parameter is missing.", undefined, HttpStatusCode.Unauthorized) };
      return { kind: "ok", client: undefined };
    }
    const client = this.clientOptions.findClient(clientId);
    if (!client) {
      if (this.clientOptions.clients.length === 0 && grantType !== OpenIddictConstants.GrantTypes.ClientCredentials) return { kind: "ok", client: undefined };
      return { kind: "error", result: oauthError(OpenIddictConstants.Errors.InvalidClient, "The specified client is not registered.", undefined, HttpStatusCode.Unauthorized) };
    }
    if (client.clientSecretHash !== undefined) {
      const secret = request.get("client_secret");
      if (secret === undefined || !verifyClientSecret(secret, client.clientSecretHash)) {
        return { kind: "error", result: oauthError(OpenIddictConstants.Errors.InvalidClient, "The specified client credentials are invalid.", undefined, HttpStatusCode.Unauthorized) };
      }
    }
    if (client.allowedGrantTypes && grantType !== "revocation" && !client.allowedGrantTypes.includes(grantType)) {
      return { kind: "error", result: oauthError(OpenIddictConstants.Errors.UnauthorizedClient, `The client is not allowed to use the '${grantType}' grant.`) };
    }
    return { kind: "ok", client };
  }
}

/** `GET /.well-known/openid-configuration` and `GET /.well-known/jwks.json` (port of the OpenIddict discovery endpoints). */
@Transient()
@DisableAbpFeatures({ disableUnitOfWork: true, disableAuditing: true, disableMiddleware: false })
@Controller(".well-known", { isMetadataEnabled: false })
export class WellKnownController extends AbpControllerBase {
  static readonly inject = [ISigningKeyProvider, optionsToken(AbpJwtBearerOptions)] as const;
  protected readonly options: AbpJwtBearerOptions;

  constructor(
    protected readonly signingKeyProvider: ISigningKeyProvider,
    options: IOptions<AbpJwtBearerOptions>,
  ) {
    super();
    this.options = options.value;
  }

  @HttpGet("jwks.json")
  async jwks(): Promise<HttpResult> {
    const key = await this.signingKeyProvider.getSigningKey();
    const keys = key.kind === "rsa" ? [key.publicJwk] : [];
    return HttpResult.json({ keys }).withHeader("cache-control", "public, max-age=3600");
  }

  @HttpGet("openid-configuration", fromContext())
  async openIdConfiguration(context: AbpHttpContext): Promise<HttpResult> {
    const base = (this.options.issuer ?? `${context.request.scheme}://${context.request.host ?? "localhost"}`).replace(/\/+$/, "");
    return HttpResult.json({
      issuer: this.options.issuer ?? base,
      token_endpoint: `${base}/connect/token`,
      revocation_endpoint: `${base}/connect/revocation`,
      jwks_uri: `${base}/.well-known/jwks.json`,
      grant_types_supported: [OpenIddictConstants.GrantTypes.Password, OpenIddictConstants.GrantTypes.RefreshToken, OpenIddictConstants.GrantTypes.ClientCredentials],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      response_types_supported: [],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256", "HS256"],
      scopes_supported: ["openid", "profile", "email", "roles", "offline_access"],
      claims_supported: ["sub", "preferred_username", "email", "role", "tenantid"],
    }).withHeader("content-type", MimeTypes.Application.Json);
  }
}
