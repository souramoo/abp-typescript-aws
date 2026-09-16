import { isNullOrWhiteSpace } from "@abp/core";
import type { BlobContainerConfiguration } from "@abp/blob-storing";

/** Port of `AwsBlobProviderConfigurationNames` (the temporary/federated credential names are not ported). */
export const AwsBlobProviderConfigurationNames = {
  AccessKeyId: "Aws.AccessKeyId",
  SecretAccessKey: "Aws.SecretAccessKey",
  Region: "Aws.Region",
  ServiceURL: "Aws.ServiceURL",
  ForcePathStyle: "Aws.ForcePathStyle",
  ContainerName: "Aws.ContainerName",
  CreateContainerIfNotExists: "Aws.CreateContainerIfNotExists",
} as const;

/** Port of `AwsBlobProviderConfiguration`: a typed view over the container configuration properties. */
export class AwsBlobProviderConfiguration {
  constructor(private readonly containerConfiguration: BlobContainerConfiguration) {}

  /** Static credentials; prefer the default credential provider chain (Lambda role) and leave these unset. */
  get accessKeyId(): string | undefined {
    return this.containerConfiguration.getConfigurationOrDefault<string>(AwsBlobProviderConfigurationNames.AccessKeyId);
  }
  set accessKeyId(value: string | undefined) {
    this.setOrClear(AwsBlobProviderConfigurationNames.AccessKeyId, value);
  }

  get secretAccessKey(): string | undefined {
    return this.containerConfiguration.getConfigurationOrDefault<string>(AwsBlobProviderConfigurationNames.SecretAccessKey);
  }
  set secretAccessKey(value: string | undefined) {
    this.setOrClear(AwsBlobProviderConfigurationNames.SecretAccessKey, value);
  }

  /** The AWS region (e.g. `us-east-1`); when unset the SDK resolves it (`AWS_REGION`). */
  get region(): string | undefined {
    return this.containerConfiguration.getConfigurationOrDefault<string>(AwsBlobProviderConfigurationNames.Region);
  }
  set region(value: string | undefined) {
    this.setOrClear(AwsBlobProviderConfigurationNames.Region, value);
  }

  /** Custom service URL for S3-compatible APIs (MinIO, R2, LocalStack); implies path-style addressing. */
  get serviceUrl(): string | undefined {
    return this.containerConfiguration.getConfigurationOrDefault<string>(AwsBlobProviderConfigurationNames.ServiceURL);
  }
  set serviceUrl(value: string | undefined) {
    this.setOrClear(AwsBlobProviderConfigurationNames.ServiceURL, value);
  }

  /** Default: true when `serviceUrl` is set, false otherwise. */
  get forcePathStyle(): boolean {
    return this.containerConfiguration.getConfigurationOrDefault<boolean>(AwsBlobProviderConfigurationNames.ForcePathStyle, !isNullOrWhiteSpace(this.serviceUrl)) ?? false;
  }
  set forcePathStyle(value: boolean) {
    this.containerConfiguration.setConfiguration(AwsBlobProviderConfigurationNames.ForcePathStyle, value);
  }

  /**
   * The bucket that stores the container's blobs. When unset the container name is the bucket name (as in .NET);
   * when set, several containers share one bucket and blob keys are prefixed with the container name.
   */
  get containerName(): string | undefined {
    return this.containerConfiguration.getConfigurationOrDefault<string>(AwsBlobProviderConfigurationNames.ContainerName);
  }
  set containerName(value: string | undefined) {
    this.setOrClear(AwsBlobProviderConfigurationNames.ContainerName, value);
  }

  /** Alias of `containerName` in AWS terms. */
  get bucketName(): string | undefined {
    return this.containerName;
  }
  set bucketName(value: string | undefined) {
    this.containerName = value;
  }

  /** Default: false. */
  get createContainerIfNotExists(): boolean {
    return this.containerConfiguration.getConfigurationOrDefault<boolean>(AwsBlobProviderConfigurationNames.CreateContainerIfNotExists, false) ?? false;
  }
  set createContainerIfNotExists(value: boolean) {
    this.containerConfiguration.setConfiguration(AwsBlobProviderConfigurationNames.CreateContainerIfNotExists, value);
  }

  /** Key of the S3 client cache: containers with equal connection settings share one client. */
  get clientCacheKey(): string {
    return JSON.stringify([this.region ?? "", this.serviceUrl ?? "", this.forcePathStyle, this.accessKeyId ?? ""]);
  }

  private setOrClear(name: string, value: string | undefined): void {
    if (value === undefined) this.containerConfiguration.clearConfiguration(name);
    else this.containerConfiguration.setConfiguration(name, value);
  }
}

/** Port of `AwsBlobContainerConfigurationExtensions.GetAwsConfiguration`. */
export function getAwsConfiguration(containerConfiguration: BlobContainerConfiguration): AwsBlobProviderConfiguration {
  return new AwsBlobProviderConfiguration(containerConfiguration);
}
