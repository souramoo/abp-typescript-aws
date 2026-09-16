import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { IBlobContainer, IBlobContainerFactory, registerBlobContainers } from "./blob-container.js";
import { DefaultContainer } from "./blob-container-name.js";
import "./blob-naming.js";
import "./blob-provider-selector.js";
import "./memory/memory-blob-provider.js";
import "./file-system/file-system-blob-naming-normalizer.js";
import "./file-system/file-system-blob-provider.js";

/**
 * Port of `AbpBlobStoringModule` + `AbpBlobStoringMemoryModule` + `AbpBlobStoringFileSystemModule` (the memory and
 * file-system providers have no extra dependencies, so they ship in this package). `AbpThreadingModule` is part of
 * `@abp/core`. Blob encryption (`AbpBlobStoringEncryptionOptions`) is not ported.
 */
@DependsOn(AbpMultiTenancyModule)
export class AbpBlobStoringModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addTransient(IBlobContainer, { useFactory: (provider) => provider.getRequired(IBlobContainerFactory).create(DefaultContainer) });
  }

  override postConfigureServices(context: ServiceConfigurationContext): void {
    registerBlobContainers(context.services);
  }
}
