import { AbpModule, DependsOn, IConfiguration, ServiceLifetime, isNullOrWhiteSpace, type IConfiguration as Configuration, type ServiceConfigurationContext } from "@abp/core";
import { AbpAspNetCoreModule, AbpAspNetCoreMvcModule, AbpAuthenticationOptions } from "@abp/aws-lambda";
import { AbpCachingModule } from "@abp/caching";
import { AbpSecurityModule } from "@abp/security";
import { AbpJwtBearerOptions, AbpJwtClientOptions, type JwtSigningOptions } from "./abp-jwt-bearer-options.js";
import { JwtBearerAuthenticationHandler } from "./jwt-bearer-authentication-handler.js";
import { DistributedCacheRefreshTokenStore, IRefreshTokenStore } from "./refresh-token-store.js";
import { AbpJwtConfigurationKeys } from "./signing-key-provider.js";
import "./controllers.js";
import "./jwt-token-issuer.js";
import "./resource-owner-password-validator.js";
import "./signing-key-provider.js";

/**
 * Port of `AbpAspNetCoreAuthenticationJwtBearerModule` plus the token endpoint of `AbpOpenIddictAspNetCoreModule`
 * (hence the MVC module dependency). Registers the `Bearer` scheme and binds `AbpJwtBearerOptions` from `Abp:Auth:Jwt`.
 */
@DependsOn(AbpSecurityModule, AbpCachingModule, AbpAspNetCoreModule, AbpAspNetCoreMvcModule)
export class AbpAspNetCoreAuthenticationJwtBearerModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    if (configuration) this.configure(AbpJwtBearerOptions, (options) => bindJwtOptionsFromConfiguration(configuration, options));
    this.configure(AbpJwtClientOptions, (options) => {
      if (configuration) bindClientsFromConfiguration(configuration, options);
    });

    this.configure(AbpAuthenticationOptions, (options) => {
      const scheme = context.services.options.executePreConfiguredActions(AbpJwtBearerOptions).scheme;
      options.addScheme(scheme, JwtBearerAuthenticationHandler);
      options.defaultChallengeScheme ??= scheme;
    });
  }

  override postConfigureServices(context: ServiceConfigurationContext): void {
    const options = context.services.options.build(AbpJwtBearerOptions);
    if (options.refreshTokenStore === "distributed-cache") context.services.replace(IRefreshTokenStore, DistributedCacheRefreshTokenStore, ServiceLifetime.Singleton);
  }
}

/** Binds `Abp:Auth:Jwt:{Issuer,Audience,Scheme,SigningKey,PrivateKeyPem,PublicKeyPem,JwksUri,AccessTokenLifetimeSeconds,…}`. */
export function bindJwtOptionsFromConfiguration(configuration: Configuration, options: AbpJwtBearerOptions): void {
  const section = configuration.getSection(AbpJwtConfigurationKeys.Section);
  if (!section.exists()) return;
  const issuer = section.get("Issuer");
  if (!isNullOrWhiteSpace(issuer)) options.issuer = issuer;
  const audience = section.get("Audience");
  if (!isNullOrWhiteSpace(audience)) options.audience = audience;
  const scheme = section.get("Scheme");
  if (!isNullOrWhiteSpace(scheme)) options.scheme = scheme;
  for (const [key, property] of [
    ["AccessTokenLifetimeSeconds", "accessTokenLifetimeSeconds"],
    ["RefreshTokenLifetimeSeconds", "refreshTokenLifetimeSeconds"],
    ["ClockToleranceSeconds", "clockToleranceSeconds"],
  ] as const) {
    const value = Number(section.get(key));
    if (section.get(key) !== undefined && Number.isFinite(value)) options[property] = value;
  }
  const store = section.get("RefreshTokenStore");
  if (store === "memory" || store === "distributed-cache") options.refreshTokenStore = store;

  const signing = signingFromConfiguration(section, options.signing);
  if (signing) options.signing = signing;
}

function signingFromConfiguration(section: Configuration, current: JwtSigningOptions): JwtSigningOptions | undefined {
  const kind = section.get("Signing")?.toLowerCase();
  const privateKeyPem = section.get("PrivateKeyPem");
  const publicKeyPem = section.get("PublicKeyPem");
  const jwksUri = section.get("JwksUri");
  const secret = section.get("SigningKey");
  if (kind === "jwks" || (kind === undefined && !isNullOrWhiteSpace(jwksUri) && current.kind === "hmac" && current.secret === undefined)) return { kind: "jwks", jwksUri: jwksUri ?? undefined };
  if (kind === "rsa" || (kind === undefined && (!isNullOrWhiteSpace(privateKeyPem) || !isNullOrWhiteSpace(publicKeyPem)))) return { kind: "rsa", privateKeyPem: privateKeyPem ?? undefined, publicKeyPem: publicKeyPem ?? undefined };
  if (kind === "hmac" || !isNullOrWhiteSpace(secret)) return { kind: "hmac", secret: secret ?? (current.kind === "hmac" ? current.secret : undefined) };
  return undefined;
}

/** Binds `Abp:Auth:Jwt:Clients:<n>:{ClientId,ClientSecretHash,DisplayName,AllowedGrantTypes,Scopes}`. */
function bindClientsFromConfiguration(configuration: Configuration, options: AbpJwtClientOptions): void {
  const section = configuration.getSection(`${AbpJwtConfigurationKeys.Section}:Clients`);
  if (!section.exists()) return;
  for (const child of section.getChildren()) {
    const clientId = child.get("ClientId");
    if (isNullOrWhiteSpace(clientId) || options.findClient(clientId)) continue;
    const list = (key: string): string[] | undefined => {
      const value = child.getSection(key);
      if (!value.exists()) return undefined;
      return value.getChildren().map((c) => c.value).filter((v): v is string => v !== undefined);
    };
    options.clients.push({ clientId, clientSecretHash: child.get("ClientSecretHash") ?? undefined, displayName: child.get("DisplayName") ?? undefined, allowedGrantTypes: list("AllowedGrantTypes"), scopes: list("Scopes") });
  }
}
