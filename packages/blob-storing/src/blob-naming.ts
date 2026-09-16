import { IServiceProviderToken, Transient, createToken, isNullOrWhiteSpace, type IServiceProvider } from "@abp/core";
import type { BlobContainerConfiguration } from "./blob-container-configuration.js";

/** Port of `IBlobNamingNormalizer`: implementations are classes resolved from DI (`configuration.namingNormalizers`). */
export interface IBlobNamingNormalizer {
  normalizeContainerName(containerName: string): string;
  normalizeBlobName(blobName: string): string;
}

/** Port of `BlobNormalizeNaming`. */
export class BlobNormalizeNaming {
  constructor(
    readonly containerName: string | undefined,
    readonly blobName: string | undefined,
  ) {}
}

/** Port of `IBlobNormalizeNamingService`. */
export interface IBlobNormalizeNamingService {
  normalizeNaming(configuration: BlobContainerConfiguration, containerName: string | undefined, blobName: string | undefined): BlobNormalizeNaming;
  normalizeContainerName(configuration: BlobContainerConfiguration, containerName: string): string;
  normalizeBlobName(configuration: BlobContainerConfiguration, blobName: string): string;
}
export const IBlobNormalizeNamingService = createToken<IBlobNormalizeNamingService>("IBlobNormalizeNamingService");

/** Port of `BlobNormalizeNamingService`. */
@Transient(IBlobNormalizeNamingService)
export class BlobNormalizeNamingService implements IBlobNormalizeNamingService {
  static readonly inject = [IServiceProviderToken] as const;

  constructor(protected readonly serviceProvider: IServiceProvider) {}

  normalizeNaming(configuration: BlobContainerConfiguration, containerName: string | undefined, blobName: string | undefined): BlobNormalizeNaming {
    const normalizerTypes = configuration.getEffectiveNamingNormalizers();
    if (normalizerTypes.length === 0) return new BlobNormalizeNaming(containerName, blobName);

    for (const normalizerType of normalizerTypes) {
      const normalizer = this.serviceProvider.getRequired(normalizerType);
      containerName = isNullOrWhiteSpace(containerName) ? containerName : normalizer.normalizeContainerName(containerName);
      blobName = isNullOrWhiteSpace(blobName) ? blobName : normalizer.normalizeBlobName(blobName);
    }
    return new BlobNormalizeNaming(containerName, blobName);
  }

  normalizeContainerName(configuration: BlobContainerConfiguration, containerName: string): string {
    return this.normalizeNaming(configuration, containerName, undefined).containerName!;
  }

  normalizeBlobName(configuration: BlobContainerConfiguration, blobName: string): string {
    return this.normalizeNaming(configuration, undefined, blobName).blobName!;
  }
}
