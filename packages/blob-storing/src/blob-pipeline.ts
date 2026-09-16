import { Check, type Guid, type IServiceProvider, type IServiceProviderAccessor } from "@abp/core";
import type { BlobContainerConfiguration } from "./blob-container-configuration.js";

/**
 * Port of `BlobPipelineContext`. Blobs are byte arrays here, so a contributor transforms `content` in place
 * instead of wrapping a stream; the stream-ownership rules of the .NET version do not apply.
 */
export class BlobPipelineContext implements IServiceProviderAccessor {
  readonly serviceProvider: IServiceProvider;
  readonly containerName: string;
  readonly blobName: string;
  readonly configuration: BlobContainerConfiguration;
  content: Uint8Array;

  constructor(
    serviceProvider: IServiceProvider,
    containerName: string,
    blobName: string,
    configuration: BlobContainerConfiguration,
    readonly tenantId: Guid | undefined,
    content: Uint8Array,
    readonly signal: AbortSignal | undefined = undefined,
  ) {
    this.serviceProvider = Check.notNull(serviceProvider, "serviceProvider");
    this.containerName = Check.notNullOrWhiteSpace(containerName, "containerName");
    this.blobName = Check.notNullOrWhiteSpace(blobName, "blobName");
    this.configuration = Check.notNull(configuration, "configuration");
    this.content = Check.notNull(content, "content");
  }
}

/**
 * Port of `IBlobPipelineContributor`: transforms the BLOB content while it is saved (`onSaving`, in configuration
 * order) and read (`onGetting`, in reverse order). Contributors are classes resolved from a scope per operation.
 */
export interface IBlobPipelineContributor {
  onSaving(context: BlobPipelineContext): Promise<void>;
  onGetting(context: BlobPipelineContext): Promise<void>;
}
