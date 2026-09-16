import { AbpException, Check, IServiceProviderToken, Transient, createToken, optionsToken, type AbstractClass, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpBlobStoringOptions, type BlobContainerConfiguration } from "./blob-container-configuration.js";
import { BlobContainerNameAttribute } from "./blob-container-name.js";
import { IBlobProvider } from "./blob-provider.js";

/** Port of `IBlobContainerConfigurationProvider`. */
export interface IBlobContainerConfigurationProvider {
  get(name: string): BlobContainerConfiguration;
}
export const IBlobContainerConfigurationProvider = createToken<IBlobContainerConfigurationProvider>("IBlobContainerConfigurationProvider");

/** Port of `DefaultBlobContainerConfigurationProvider`. */
@Transient(IBlobContainerConfigurationProvider)
export class DefaultBlobContainerConfigurationProvider implements IBlobContainerConfigurationProvider {
  static readonly inject = [optionsToken(AbpBlobStoringOptions)] as const;
  protected readonly options: AbpBlobStoringOptions;

  constructor(options: IOptions<AbpBlobStoringOptions>) {
    this.options = options.value;
  }

  get(name: string): BlobContainerConfiguration {
    return this.options.containers.getConfiguration(name);
  }
}

/** Port of `BlobContainerConfigurationProviderExtensions.Get<TContainer>`. */
export function getContainerConfiguration(provider: IBlobContainerConfigurationProvider, containerType: AbstractClass): BlobContainerConfiguration {
  return provider.get(BlobContainerNameAttribute.getContainerName(containerType));
}

/** Port of `IBlobProviderSelector`. */
export interface IBlobProviderSelector {
  get(containerName: string): IBlobProvider;
}
export const IBlobProviderSelector = createToken<IBlobProviderSelector>("IBlobProviderSelector");

/** Port of `DefaultBlobProviderSelector`: picks the registered `IBlobProvider` that is an instance of the configured `providerType`. */
@Transient(IBlobProviderSelector)
export class DefaultBlobProviderSelector implements IBlobProviderSelector {
  static readonly inject = [IBlobContainerConfigurationProvider, IServiceProviderToken] as const;

  constructor(
    protected readonly configurationProvider: IBlobContainerConfigurationProvider,
    protected readonly serviceProvider: IServiceProvider,
  ) {}

  get(containerName: string): IBlobProvider {
    Check.notNull(containerName, "containerName");
    const configuration = this.configurationProvider.get(containerName);
    const blobProviders = this.serviceProvider.getAll(IBlobProvider);

    if (blobProviders.length === 0) {
      throw new AbpException("No BLOB Storage provider was registered! At least one provider must be registered to be able to use the BLOB Storing System.");
    }
    const providerType = configuration.providerType;
    if (providerType === undefined) {
      throw new AbpException("No BLOB Storage provider was used! At least one provider must be configured to be able to use the BLOB Storing System.");
    }
    const provider = blobProviders.find((p) => p instanceof providerType);
    if (provider) return provider;

    throw new AbpException(`Could not find the BLOB Storage provider with the type (${providerType.name}) configured for the container ${containerName} and no default provider was set.`);
  }
}
