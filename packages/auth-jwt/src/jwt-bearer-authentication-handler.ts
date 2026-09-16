import { ILoggerFactory, LogLevel, Transient, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { AbpAspNetCoreTokenUnauthorizedErrorInfo, AuthenticateResult, type AbpHttpContext, type IAuthenticationHandler } from "@abp/aws-lambda";
import { AbpExceptionHandlingConsts } from "@abp/http";
import { errors as joseErrors, jwtVerify, type JWTVerifyOptions } from "jose";
import { AbpJwtBearerOptions } from "./abp-jwt-bearer-options.js";
import { createBearerPrincipal, payloadToClaims } from "./claims-mapping.js";
import { ISigningKeyProvider, type SigningKeyMaterial } from "./signing-key-provider.js";

/** Reads `Authorization: Bearer <token>`. */
export function readBearerToken(context: AbpHttpContext): string | undefined {
  const authorization = context.request.headers.get("authorization");
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * Port of `JwtBearerHandler` (+ ABP's `AddAbpJwtBearer` challenge decoration): verifies the bearer token with the
 * configured key material and maps its claims to `AbpClaimTypes`. An invalid token leaves the request anonymous and
 * records `invalid_token` for the `WWW-Authenticate` challenge.
 */
@Transient()
export class JwtBearerAuthenticationHandler implements IAuthenticationHandler {
  static readonly inject = [optionsToken(AbpJwtBearerOptions), ISigningKeyProvider, ILoggerFactory] as const;
  protected readonly options: AbpJwtBearerOptions;
  protected readonly logger: ILogger;

  constructor(
    options: IOptions<AbpJwtBearerOptions>,
    protected readonly signingKeyProvider: ISigningKeyProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(JwtBearerAuthenticationHandler.name);
  }

  async authenticate(context: AbpHttpContext): Promise<AuthenticateResult> {
    const token = readBearerToken(context);
    if (!token) return AuthenticateResult.noResult();

    try {
      const key = await this.signingKeyProvider.getSigningKey();
      const payload = await this.verify(token, key);
      return AuthenticateResult.success(createBearerPrincipal(payloadToClaims(payload, this.options.claimMappings), this.options.scheme));
    } catch (e) {
      this.logger.log(LogLevel.Debug, "Bearer token validation failed.", undefined, e);
      return AuthenticateResult.fail(AbpExceptionHandlingConsts.InvalidToken, describeError(e));
    }
  }

  async challenge(context: AbpHttpContext): Promise<void> {
    const info = context.serviceProvider.get(AbpAspNetCoreTokenUnauthorizedErrorInfo);
    const parts = [this.options.scheme];
    if (info?.error) parts.push(`error="${info.error}"`);
    if (info?.errorDescription) parts.push(`error_description="${info.errorDescription.replace(/"/g, "'")}"`);
    if (info?.errorUri) parts.push(`error_uri="${info.errorUri}"`);
    context.response.headers.set("www-authenticate", parts.length === 1 ? parts[0]! : `${parts[0]} ${parts.slice(1).join(", ")}`);
  }

  protected async verify(token: string, key: SigningKeyMaterial) {
    const verifyOptions: JWTVerifyOptions = { clockTolerance: this.options.clockToleranceSeconds };
    if (this.options.issuer) verifyOptions.issuer = this.options.issuer;
    if (this.options.audience) verifyOptions.audience = this.options.audience;
    switch (key.kind) {
      case "hmac":
        return (await jwtVerify(token, key.secret, { ...verifyOptions, algorithms: [key.algorithm] })).payload;
      case "rsa":
        return (await jwtVerify(token, key.publicKey, { ...verifyOptions, algorithms: [key.algorithm] })).payload;
      case "jwks":
        return (await jwtVerify(token, key.getKey, verifyOptions)).payload;
      default: {
        const _exhaustive: never = key;
        throw new Error(`Unknown key ${String(_exhaustive)}`);
      }
    }
  }
}

function describeError(e: unknown): string {
  if (e instanceof joseErrors.JWTExpired) return "The token expired.";
  if (e instanceof joseErrors.JWTClaimValidationFailed) return `The token is invalid: ${e.message}`;
  if (e instanceof joseErrors.JOSEError) return "The token signature is invalid.";
  return e instanceof Error ? e.message : String(e);
}
