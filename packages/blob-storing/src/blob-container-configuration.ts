import { AbpException, Check, TypeList, type AbstractClass, type Class } from "@abp/core";
import { BlobContainerNameAttribute, DefaultContainer } from "./blob-container-name.js";
import type { IBlobNamingNormalizer } from "./blob-naming.js";
import type { IBlobPipelineContributor } from "./blob-pipeline.js";
import type { IBlobProvider } from "./blob-provider.js";
import { FileSystemBlobProvider } from "./file-system/file-system-blob-provider.js";
import { FileSystemBlobNamingNormalizer } from "./file-system/file-system-blob-naming-normalizer.js";
import { FileSystemBlobProviderConfiguration } from "./file-system/file-system-blob-provider-configuration.js";
import { MemoryBlobProvider } from "./memory/memory-blob-provider.js";

/** Port of `BlobContainerConfiguration` (+ the `UseMemory`/`UseFileSystem` extension methods of the provider packages). */
export class BlobContainerConfiguration {
  private ownProviderType: Class<IBlobProvider> | undefined;
  /**
   * Indicates whether this container is multi-tenant. If false in a multi-tenant application the container is
   * shared by all tenants. Default: true.
   */
  isMultiTenant = true;
  readonly namingNormalizers = new TypeList<IBlobNamingNormalizer>();
  /** Content transformations applied while saving (in order) and reading (reversed). */
  readonly pipelineContributors = new TypeList<IBlobPipelineContributor>();
  /** Set false to stop inheriting the pipeline contributors of the default container configuration. Default: true. */
  inheritPipelineContributors = true;
  private readonly properties = new Map<string, unknown>();

  constructor(private readonly fallbackConfiguration?: BlobContainerConfiguration) {}

  /** The provider used to store BLOBs of this container (falls back to the default container's provider). */
  get providerType(): Class<IBlobProvider> | undefined {
    return this.ownProviderType ?? this.fallbackConfiguration?.providerType;
  }
  set providerType(value: Class<IBlobProvider> | undefined) {
    this.ownProviderType = value;
  }

  /** Naming normalizers in effect: inherited only when this container has none and does not override the provider. */
  getEffectiveNamingNormalizers(): Class<IBlobNamingNormalizer>[] {
    if (this.namingNormalizers.length === 0 && this.ownProviderType === undefined && this.fallbackConfiguration) {
      return this.fallbackConfiguration.getEffectiveNamingNormalizers();
    }
    return this.namingNormalizers.toArray();
  }

  /** Pipeline contributors in effect: the default configuration's first, then the own ones (each type once). */
  getEffectivePipelineContributors(): Class<IBlobPipelineContributor>[] {
    if (!this.fallbackConfiguration || !this.inheritPipelineContributors) return [...new Set(this.pipelineContributors)];
    return [...new Set([...this.fallbackConfiguration.getEffectivePipelineContributors(), ...this.pipelineContributors])];
  }

  getConfigurationOrDefault<T>(name: string, defaultValue?: T): T | undefined {
    return this.getConfigurationOrNull(name, defaultValue) as T | undefined;
  }

  getConfigurationOrNull(name: string, defaultValue?: unknown): unknown {
    return this.properties.get(name) ?? this.fallbackConfiguration?.getConfigurationOrNull(name, defaultValue) ?? defaultValue;
  }

  /** Port of `BlobContainerConfigurationExtensions.GetConfiguration`: throws when the value is missing. */
  getConfiguration<T>(name: string): T {
    const value = this.getConfigurationOrNull(name);
    if (value === undefined || value === null) throw new AbpException(`Could not find the configuration value for '${name}'!`);
    return value as T;
  }

  setConfiguration(name: string, value: unknown): this {
    Check.notNullOrWhiteSpace(name, "name");
    Check.notNull(value, "value");
    this.properties.set(name, value);
    return this;
  }

  clearConfiguration(name: string): this {
    Check.notNullOrWhiteSpace(name, "name");
    this.properties.delete(name);
    return this;
  }

  /** Port of `MemoryBlobContainerConfigurationExtensions.UseMemory`. */
  useMemory(): this {
    this.providerType = MemoryBlobProvider;
    return this;
  }

  /** Port of `FileSystemBlobContainerConfigurationExtensions.UseFileSystem`. */
  useFileSystem(configure: (configuration: FileSystemBlobProviderConfiguration) => void): this {
    this.providerType = FileSystemBlobProvider;
    this.namingNormalizers.tryAdd(FileSystemBlobNamingNormalizer);
    configure(new FileSystemBlobProviderConfiguration(this));
    return this;
  }

  /** Port of `FileSystemBlobContainerConfigurationExtensions.GetFileSystemConfiguration`. */
  getFileSystemConfiguration(): FileSystemBlobProviderConfiguration {
    return new FileSystemBlobProviderConfiguration(this);
  }
}

function containerNameOf(containerTypeOrName: AbstractClass | string): string {
  return typeof containerTypeOrName === "string" ? containerTypeOrName : BlobContainerNameAttribute.getContainerName(containerTypeOrName);
}

/** Port of `BlobContainerConfigurations`. */
export class BlobContainerConfigurations {
  private readonly containers = new Map<string, BlobContainerConfiguration>([[DefaultContainer.Name, new BlobContainerConfiguration()]]);

  private get default(): BlobContainerConfiguration {
    return this.getConfiguration(DefaultContainer);
  }

  /** `Configure<TContainer>(...)` / `Configure(name, ...)`. */
  configure(containerTypeOrName: AbstractClass | string, configureAction: (configuration: BlobContainerConfiguration) => void): this {
    const name = Check.notNullOrWhiteSpace(containerNameOf(containerTypeOrName), "name");
    Check.notNull(configureAction, "configureAction");
    let configuration = this.containers.get(name);
    if (!configuration) {
      configuration = new BlobContainerConfiguration(this.default);
      this.containers.set(name, configuration);
    }
    configureAction(configuration);
    return this;
  }

  configureDefault(configureAction: (configuration: BlobContainerConfiguration) => void): this {
    configureAction(this.default);
    return this;
  }

  configureAll(configureAction: (name: string, configuration: BlobContainerConfiguration) => void): this {
    for (const [name, configuration] of this.containers) configureAction(name, configuration);
    return this;
  }

  getConfiguration(containerTypeOrName: AbstractClass | string): BlobContainerConfiguration {
    const name = Check.notNullOrWhiteSpace(containerNameOf(containerTypeOrName), "name");
    return this.containers.get(name) ?? this.default;
  }
}

/** Port of `AbpBlobStoringOptions`. */
export class AbpBlobStoringOptions {
  readonly containers = new BlobContainerConfigurations();
}
