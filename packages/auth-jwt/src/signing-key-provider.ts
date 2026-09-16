import { AbpException, IConfiguration, Singleton, createToken, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { calculateJwkThumbprint, createLocalJWKSet, createRemoteJWKSet, exportJWK, importPKCS8, importSPKI, type CryptoKey, type JWK, type JWTVerifyGetKey } from "jose";
import { createPublicKey } from "node:crypto";
import { AbpJwtBearerOptions } from "./abp-jwt-bearer-options.js";

/** Resolved key material: what the issuer signs with and the handler verifies with. */
export type SigningKeyMaterial =
  | { readonly kind: "hmac"; readonly algorithm: "HS256"; readonly secret: Uint8Array }
  | { readonly kind: "rsa"; readonly algorithm: "RS256"; readonly privateKey: CryptoKey | undefined; readonly publicKey: CryptoKey; readonly publicJwk: JWK; readonly kid: string }
  | { readonly kind: "jwks"; readonly getKey: JWTVerifyGetKey };

/** Where the signing key comes from (configuration/env by default; a Secrets Manager implementation can replace it). */
export interface ISigningKeyProvider {
  getSigningKey(): Promise<SigningKeyMaterial>;
}
export const ISigningKeyProvider = createToken<ISigningKeyProvider>("ISigningKeyProvider");

export const AbpJwtConfigurationKeys = {
  Section: "Abp:Auth:Jwt",
  SigningKey: "Abp:Auth:Jwt:SigningKey",
  SigningKeySecretArn: "Abp:Auth:Jwt:SigningKeySecretArn",
  PrivateKeyPem: "Abp:Auth:Jwt:PrivateKeyPem",
  PublicKeyPem: "Abp:Auth:Jwt:PublicKeyPem",
  JwksUri: "Abp:Auth:Jwt:JwksUri",
  /** The env var read when the configuration has no value (`__` is the .NET section separator). */
  SigningKeyEnvironmentVariable: "ABP__Auth__Jwt__SigningKey",
  SigningKeySecretArnEnvironmentVariable: "ABP__Auth__Jwt__SigningKeySecretArn",
} as const;

/**
 * Default `ISigningKeyProvider`: reads `AbpJwtBearerOptions.signing`, falling back to configuration
 * (`Abp:Auth:Jwt:SigningKey`, `PrivateKeyPem`/`PublicKeyPem`, `JwksUri`) and the `ABP__Auth__Jwt__SigningKey` env var.
 * A `SigningKeySecretArn` is not fetched here: register an `ISigningKeyProvider` backed by Secrets Manager for it.
 */
@Singleton(ISigningKeyProvider)
export class ConfigurationSigningKeyProvider implements ISigningKeyProvider {
  static readonly inject = [optionsToken(AbpJwtBearerOptions), IConfiguration] as const;
  private readonly options: AbpJwtBearerOptions;
  private cached: Promise<SigningKeyMaterial> | undefined;

  constructor(
    options: IOptions<AbpJwtBearerOptions>,
    private readonly configuration: IConfiguration,
  ) {
    this.options = options.value;
  }

  getSigningKey(): Promise<SigningKeyMaterial> {
    this.cached ??= this.load().catch((e: unknown) => {
      this.cached = undefined;
      throw e;
    });
    return this.cached;
  }

  protected async load(): Promise<SigningKeyMaterial> {
    const signing = this.options.signing;
    switch (signing.kind) {
      case "hmac": {
        const secret = signing.secret ?? this.configuration.get(AbpJwtConfigurationKeys.SigningKey) ?? process.env[AbpJwtConfigurationKeys.SigningKeyEnvironmentVariable];
        if (isNullOrWhiteSpace(secret)) {
          const arn = this.configuration.get(AbpJwtConfigurationKeys.SigningKeySecretArn) ?? process.env[AbpJwtConfigurationKeys.SigningKeySecretArnEnvironmentVariable];
          if (!isNullOrWhiteSpace(arn)) throw new AbpException(`The JWT signing key is stored in Secrets Manager (${arn}); register an ISigningKeyProvider that fetches it (the default provider does not use the AWS SDK).`);
          throw new AbpException(`No JWT signing key: set AbpJwtBearerOptions.signing, the '${AbpJwtConfigurationKeys.SigningKey}' configuration value or the ${AbpJwtConfigurationKeys.SigningKeyEnvironmentVariable} environment variable.`);
        }
        const bytes = new TextEncoder().encode(secret);
        if (bytes.length < 32) throw new AbpException("The HMAC signing key must be at least 32 bytes (256 bits) long for HS256.");
        return { kind: "hmac", algorithm: "HS256", secret: bytes };
      }
      case "rsa": {
        const privateKeyPem = signing.privateKeyPem ?? this.configuration.get(AbpJwtConfigurationKeys.PrivateKeyPem);
        const publicKeyPem = signing.publicKeyPem ?? this.configuration.get(AbpJwtConfigurationKeys.PublicKeyPem) ?? (privateKeyPem ? derivePublicKeyPem(privateKeyPem) : undefined);
        if (!publicKeyPem) throw new AbpException("RSA signing needs a private key PEM (to issue tokens) or a public key PEM (to verify them).");
        const privateKey = privateKeyPem ? await importPKCS8(privateKeyPem, "RS256") : undefined;
        const publicKey = await importSPKI(publicKeyPem, "RS256", { extractable: true });
        const publicJwk = await exportJWK(publicKey);
        const kid = await calculateJwkThumbprint(publicJwk);
        return { kind: "rsa", algorithm: "RS256", privateKey, publicKey, publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" }, kid };
      }
      case "jwks": {
        if (signing.jwks) return { kind: "jwks", getKey: createLocalJWKSet(signing.jwks) };
        const jwksUri = signing.jwksUri ?? this.configuration.get(AbpJwtConfigurationKeys.JwksUri);
        if (isNullOrWhiteSpace(jwksUri)) throw new AbpException("JWKS signing needs `jwksUri` (or an inline `jwks` document).");
        return { kind: "jwks", getKey: createRemoteJWKSet(new URL(jwksUri)) };
      }
      default: {
        const _exhaustive: never = signing;
        throw new AbpException(`Unknown signing kind ${String(_exhaustive)}`);
      }
    }
  }
}

export function derivePublicKeyPem(privateKeyPem: string): string {
  return createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
}
