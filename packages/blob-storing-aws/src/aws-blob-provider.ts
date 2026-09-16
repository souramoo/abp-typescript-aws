import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Transient, isNullOrWhiteSpace } from "@abp/core";
import { BlobAlreadyExistsException, BlobProviderBase, IBlobNormalizeNamingService, IBlobProvider, type BlobProviderArgs, type BlobProviderDeleteArgs, type BlobProviderExistsArgs, type BlobProviderGetArgs, type BlobProviderSaveArgs } from "@abp/blob-storing";
import { IAwsBlobNameCalculator } from "./aws-blob-name-calculator.js";
import { IAwsBlobProviderClientFactory } from "./aws-blob-provider-client-factory.js";
import { getAwsConfiguration } from "./aws-blob-provider-configuration.js";

function isNotFound(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const error = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return error.name === "NotFound" || error.name === "NoSuchKey" || error.name === "NoSuchBucket" || error.$metadata?.httpStatusCode === 404;
}

/** Port of `AwsBlobProvider` on S3 (`PutObject`/`GetObject`/`DeleteObject`/`HeadObject`). */
@Transient(IBlobProvider)
export class AwsBlobProvider extends BlobProviderBase {
  static readonly inject = [IAwsBlobNameCalculator, IAwsBlobProviderClientFactory, IBlobNormalizeNamingService] as const;

  constructor(
    protected readonly awsBlobNameCalculator: IAwsBlobNameCalculator,
    protected readonly clientFactory: IAwsBlobProviderClientFactory,
    protected readonly blobNormalizeNamingService: IBlobNormalizeNamingService,
  ) {
    super();
  }

  override async save(args: BlobProviderSaveArgs): Promise<void> {
    const blobName = this.awsBlobNameCalculator.calculate(args);
    const configuration = getAwsConfiguration(args.configuration);
    const containerName = this.getContainerName(args);
    const client = this.getClient(args);

    if (!args.overrideExisting && (await this.blobExists(client, containerName, blobName, args.signal))) {
      throw new BlobAlreadyExistsException(`Saving BLOB '${args.blobName}' does already exists in the container '${containerName}'! Set overrideExisting if it should be overwritten.`);
    }
    if (configuration.createContainerIfNotExists) await this.createContainerIfNotExists(client, containerName, args.signal);

    await client.send(new PutObjectCommand({ Bucket: containerName, Key: blobName, Body: args.blobContent, ContentLength: args.blobContent.byteLength }), { abortSignal: args.signal });
  }

  override async delete(args: BlobProviderDeleteArgs): Promise<boolean> {
    const blobName = this.awsBlobNameCalculator.calculate(args);
    const containerName = this.getContainerName(args);
    const client = this.getClient(args);
    if (!(await this.blobExists(client, containerName, blobName, args.signal))) return false;
    await client.send(new DeleteObjectCommand({ Bucket: containerName, Key: blobName }), { abortSignal: args.signal });
    return true;
  }

  override async exists(args: BlobProviderExistsArgs): Promise<boolean> {
    return this.blobExists(this.getClient(args), this.getContainerName(args), this.awsBlobNameCalculator.calculate(args), args.signal);
  }

  override async getOrNull(args: BlobProviderGetArgs): Promise<Uint8Array | undefined> {
    const blobName = this.awsBlobNameCalculator.calculate(args);
    const containerName = this.getContainerName(args);
    try {
      const response = await this.getClient(args).send(new GetObjectCommand({ Bucket: containerName, Key: blobName }), { abortSignal: args.signal });
      if (!response.Body) return undefined;
      return await response.Body.transformToByteArray();
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }

  protected getClient(args: BlobProviderArgs): S3Client {
    return this.clientFactory.getClient(getAwsConfiguration(args.configuration));
  }

  protected async blobExists(client: S3Client, containerName: string, blobName: string, signal: AbortSignal | undefined): Promise<boolean> {
    try {
      await client.send(new HeadObjectCommand({ Bucket: containerName, Key: blobName }), { abortSignal: signal });
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  protected async createContainerIfNotExists(client: S3Client, containerName: string, signal: AbortSignal | undefined): Promise<void> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: containerName }), { abortSignal: signal });
    } catch (e) {
      if (!isNotFound(e)) throw e;
      await client.send(new CreateBucketCommand({ Bucket: containerName }), { abortSignal: signal });
    }
  }

  protected getContainerName(args: BlobProviderArgs): string {
    const configuration = getAwsConfiguration(args.configuration);
    return isNullOrWhiteSpace(configuration.containerName) ? args.containerName : this.blobNormalizeNamingService.normalizeContainerName(args.configuration, configuration.containerName);
  }
}
