import { Transient, createToken, isNullOrWhiteSpace } from "@abp/core";
import type { BlobProviderArgs } from "@abp/blob-storing";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { getAwsConfiguration } from "./aws-blob-provider-configuration.js";

/** Port of `IAwsBlobNameCalculator`: the S3 object key of a blob. */
export interface IAwsBlobNameCalculator {
  calculate(args: BlobProviderArgs): string;
}
export const IAwsBlobNameCalculator = createToken<IAwsBlobNameCalculator>("IAwsBlobNameCalculator");

/**
 * Port of `DefaultAwsBlobNameCalculator`: `host/{blob}` or `tenants/{tenantId}/{blob}`. When the container
 * configuration names a shared bucket, the container name is inserted (`host/{container}/{blob}`) so containers do not
 * collide, which the .NET layout cannot express because a container always is its own bucket there.
 */
@Transient(IAwsBlobNameCalculator)
export class DefaultAwsBlobNameCalculator implements IAwsBlobNameCalculator {
  static readonly inject = [ICurrentTenant] as const;

  constructor(protected readonly currentTenant: ICurrentTenant) {}

  calculate(args: BlobProviderArgs): string {
    const scope = this.currentTenant.id === undefined ? "host" : `tenants/${this.currentTenant.id}`;
    const sharedBucket = !isNullOrWhiteSpace(getAwsConfiguration(args.configuration).containerName);
    return sharedBucket ? `${scope}/${args.containerName}/${args.blobName}` : `${scope}/${args.blobName}`;
  }
}
