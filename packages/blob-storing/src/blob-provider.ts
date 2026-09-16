import { AbpException, Check, createToken } from "@abp/core";
import type { BlobContainerConfiguration } from "./blob-container-configuration.js";

/** Port of `BlobAlreadyExistsException`. */
export class BlobAlreadyExistsException extends AbpException {}

/** Port of `BlobProviderArgs`. */
export abstract class BlobProviderArgs {
  readonly containerName: string;
  readonly configuration: BlobContainerConfiguration;
  readonly blobName: string;

  protected constructor(
    containerName: string,
    configuration: BlobContainerConfiguration,
    blobName: string,
    readonly signal: AbortSignal | undefined = undefined,
  ) {
    this.containerName = Check.notNullOrWhiteSpace(containerName, "containerName");
    this.configuration = Check.notNull(configuration, "configuration");
    this.blobName = Check.notNullOrWhiteSpace(blobName, "blobName");
  }
}

/** Port of `BlobProviderSaveArgs`; the content is materialized as bytes (streams are collected by the container). */
export class BlobProviderSaveArgs extends BlobProviderArgs {
  readonly blobContent: Uint8Array;

  constructor(containerName: string, configuration: BlobContainerConfiguration, blobName: string, blobContent: Uint8Array, readonly overrideExisting = false, signal?: AbortSignal) {
    super(containerName, configuration, blobName, signal);
    this.blobContent = Check.notNull(blobContent, "blobContent");
  }
}

export class BlobProviderGetArgs extends BlobProviderArgs {
  constructor(containerName: string, configuration: BlobContainerConfiguration, blobName: string, signal?: AbortSignal) {
    super(containerName, configuration, blobName, signal);
  }
}

export class BlobProviderDeleteArgs extends BlobProviderArgs {
  constructor(containerName: string, configuration: BlobContainerConfiguration, blobName: string, signal?: AbortSignal) {
    super(containerName, configuration, blobName, signal);
  }
}

export class BlobProviderExistsArgs extends BlobProviderArgs {
  constructor(containerName: string, configuration: BlobContainerConfiguration, blobName: string, signal?: AbortSignal) {
    super(containerName, configuration, blobName, signal);
  }
}

/**
 * Port of `IBlobProvider`. Providers are registered under this token (`@Transient(IBlobProvider)` /
 * `@Singleton(IBlobProvider)`) and selected per container by `providerType` (`configuration.useMemory()` etc.).
 */
export interface IBlobProvider {
  save(args: BlobProviderSaveArgs): Promise<void>;
  delete(args: BlobProviderDeleteArgs): Promise<boolean>;
  exists(args: BlobProviderExistsArgs): Promise<boolean>;
  getOrNull(args: BlobProviderGetArgs): Promise<Uint8Array | undefined>;
}
export const IBlobProvider = createToken<IBlobProvider>("IBlobProvider");

/** Port of `BlobProviderBase`. */
export abstract class BlobProviderBase implements IBlobProvider {
  abstract save(args: BlobProviderSaveArgs): Promise<void>;
  abstract delete(args: BlobProviderDeleteArgs): Promise<boolean>;
  abstract exists(args: BlobProviderExistsArgs): Promise<boolean>;
  abstract getOrNull(args: BlobProviderGetArgs): Promise<Uint8Array | undefined>;
}
