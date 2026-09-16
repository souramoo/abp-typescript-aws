import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { Dependency, Singleton, createToken, isNullOrWhiteSpace } from "@abp/core";
import type { AwsBlobProviderConfiguration } from "./aws-blob-provider-configuration.js";

/** Port of `IAmazonS3ClientFactory`. */
export interface IAwsBlobProviderClientFactory {
  getClient(configuration: AwsBlobProviderConfiguration): S3Client;
}
export const IAwsBlobProviderClientFactory = createToken<IAwsBlobProviderClientFactory>("IAwsBlobProviderClientFactory");

/**
 * Port of `DefaultAmazonS3ClientFactory`: one cached `S3Client` per distinct connection configuration. Credentials
 * come from the default provider chain unless static keys are configured; the STS temporary/federated credential
 * modes of .NET are not ported (Lambda roles cover that need).
 */
@Dependency({ tryRegister: true })
@Singleton(IAwsBlobProviderClientFactory)
export class DefaultAwsBlobProviderClientFactory implements IAwsBlobProviderClientFactory {
  protected readonly clients = new Map<string, S3Client>();

  getClient(configuration: AwsBlobProviderConfiguration): S3Client {
    const key = configuration.clientCacheKey;
    let client = this.clients.get(key);
    if (!client) {
      client = new S3Client(this.createClientConfig(configuration));
      this.clients.set(key, client);
    }
    return client;
  }

  protected createClientConfig(configuration: AwsBlobProviderConfiguration): S3ClientConfig {
    const config: S3ClientConfig = {};
    if (!isNullOrWhiteSpace(configuration.region)) config.region = configuration.region;
    if (!isNullOrWhiteSpace(configuration.serviceUrl)) {
      config.endpoint = configuration.serviceUrl;
      config.forcePathStyle = configuration.forcePathStyle;
    } else if (configuration.forcePathStyle) {
      config.forcePathStyle = true;
    }
    if (!isNullOrWhiteSpace(configuration.accessKeyId) && !isNullOrWhiteSpace(configuration.secretAccessKey)) {
      config.credentials = { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey };
    }
    return config;
  }
}
