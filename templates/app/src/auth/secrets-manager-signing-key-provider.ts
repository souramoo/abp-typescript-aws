import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { AbpException, IConfiguration, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { AbpJwtBearerOptions, AbpJwtConfigurationKeys, ConfigurationSigningKeyProvider, type SigningKeyMaterial } from "@abp/auth-jwt";

/**
 * `ISigningKeyProvider` for AWS: when the HMAC secret is not in the configuration but `Abp:Auth:Jwt:SigningKeySecretArn`
 * (`ABP__Auth__Jwt__SigningKeySecretArn`, set by the CDK stack) is, the secret string is fetched from Secrets Manager
 * once per container. Every other signing configuration falls through to `ConfigurationSigningKeyProvider`.
 */
export class SecretsManagerSigningKeyProvider extends ConfigurationSigningKeyProvider {
  static override readonly inject = [optionsToken(AbpJwtBearerOptions), IConfiguration] as const;
  private readonly jwtOptions: AbpJwtBearerOptions;
  private readonly jwtConfiguration: IConfiguration;
  private client: SecretsManagerClient | undefined;

  constructor(options: IOptions<AbpJwtBearerOptions>, configuration: IConfiguration) {
    super(options, configuration);
    this.jwtOptions = options.value;
    this.jwtConfiguration = configuration;
  }

  protected override async load(): Promise<SigningKeyMaterial> {
    const signing = this.jwtOptions.signing;
    if (signing.kind !== "hmac" || !isNullOrWhiteSpace(signing.secret) || !isNullOrWhiteSpace(this.jwtConfiguration.get(AbpJwtConfigurationKeys.SigningKey))) return super.load();

    const secretArn = this.jwtConfiguration.get(AbpJwtConfigurationKeys.SigningKeySecretArn) ?? process.env[AbpJwtConfigurationKeys.SigningKeySecretArnEnvironmentVariable];
    if (isNullOrWhiteSpace(secretArn)) return super.load();

    const secret = await this.fetchSecret(secretArn);
    const bytes = new TextEncoder().encode(secret);
    if (bytes.length < 32) throw new AbpException(`The JWT signing key in Secrets Manager (${secretArn}) must be at least 32 bytes long for HS256.`);
    return { kind: "hmac", algorithm: "HS256", secret: bytes };
  }

  protected async fetchSecret(secretArn: string): Promise<string> {
    this.client ??= new SecretsManagerClient({});
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const value = response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary).toString("utf8") : undefined);
    if (isNullOrWhiteSpace(value)) throw new AbpException(`The secret ${secretArn} has no value.`);
    return value;
  }
}
