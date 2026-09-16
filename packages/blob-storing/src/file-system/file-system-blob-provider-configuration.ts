import { Check } from "@abp/core";
import type { BlobContainerConfiguration } from "../blob-container-configuration.js";

/** Port of `FileSystemBlobProviderConfigurationNames`. */
export const FileSystemBlobProviderConfigurationNames = {
  basePath: "FileSystem.BasePath",
  appendContainerNameToBasePath: "FileSystem.AppendContainerNameToBasePath",
} as const;

/** Port of `FileSystemBlobProviderConfiguration`: a typed view over the container configuration properties. */
export class FileSystemBlobProviderConfiguration {
  constructor(private readonly containerConfiguration: BlobContainerConfiguration) {}

  get basePath(): string {
    return this.containerConfiguration.getConfiguration<string>(FileSystemBlobProviderConfigurationNames.basePath);
  }
  set basePath(value: string) {
    this.containerConfiguration.setConfiguration(FileSystemBlobProviderConfigurationNames.basePath, Check.notNullOrWhiteSpace(value, "value"));
  }

  /** Default: true. */
  get appendContainerNameToBasePath(): boolean {
    return this.containerConfiguration.getConfigurationOrDefault<boolean>(FileSystemBlobProviderConfigurationNames.appendContainerNameToBasePath, true) ?? true;
  }
  set appendContainerNameToBasePath(value: boolean) {
    this.containerConfiguration.setConfiguration(FileSystemBlobProviderConfigurationNames.appendContainerNameToBasePath, value);
  }
}
