import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpBlobStoringModule, AbpBlobStoringOptions, type BlobContainerConfiguration } from "@abp/blob-storing";
import { AwsBlobNamingNormalizer } from "./aws-blob-naming-normalizer.js";
import { AwsBlobProvider } from "./aws-blob-provider.js";
import { AwsBlobProviderConfiguration } from "./aws-blob-provider-configuration.js";
import "./aws-blob-name-calculator.js";
import "./aws-blob-provider-client-factory.js";

/** Port of `AwsBlobContainerConfigurationExtensions.UseAws` (an extension method in .NET; a function here). */
export function useAws(containerConfiguration: BlobContainerConfiguration, configure: (configuration: AwsBlobProviderConfiguration) => void): BlobContainerConfiguration {
  containerConfiguration.providerType = AwsBlobProvider;
  containerConfiguration.namingNormalizers.tryAdd(AwsBlobNamingNormalizer);
  configure(new AwsBlobProviderConfiguration(containerConfiguration));
  return containerConfiguration;
}

/**
 * Port of `AbpBlobStoringAwsModule`. The .NET dependency on `AbpCachingModule` (temporary credential cache) is not
 * needed. When `BlobStoring:Aws:BucketName` is configured (`ABP__BlobStoring__Aws__BucketName`), the default container
 * uses S3 with that bucket unless the application configured a provider for it.
 */
@DependsOn(AbpBlobStoringModule)
export class AbpBlobStoringAwsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    const bucketName = configuration?.get("BlobStoring:Aws:BucketName");
    const region = configuration?.get("BlobStoring:Aws:Region");
    if (!bucketName) return;

    this.postConfigure(AbpBlobStoringOptions, (options) => {
      options.containers.configureDefault((container) => {
        if (container.providerType !== undefined) return;
        useAws(container, (aws) => {
          aws.bucketName = bucketName;
          if (region) aws.region = region;
        });
      });
    });
  }
}
