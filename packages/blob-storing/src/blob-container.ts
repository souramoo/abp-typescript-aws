import { Readable } from "node:stream";
import { AbpException, ICancellationTokenProvider, IServiceProviderToken, Transient, createToken, keyedToken, type AbstractClass, type Guid, type IServiceProvider, type ServiceCollection, type ServiceToken } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import type { BlobContainerConfiguration } from "./blob-container-configuration.js";
import { BlobContainerNameAttribute, DefaultContainer } from "./blob-container-name.js";
import { IBlobNormalizeNamingService, type BlobNormalizeNaming } from "./blob-naming.js";
import { BlobPipelineContext } from "./blob-pipeline.js";
import { BlobProviderDeleteArgs, BlobProviderExistsArgs, BlobProviderGetArgs, BlobProviderSaveArgs, type IBlobProvider } from "./blob-provider.js";
import { IBlobContainerConfigurationProvider, IBlobProviderSelector } from "./blob-provider-selector.js";

/** Blob content accepted by `save`: bytes, or a Node readable stream that is collected before the provider call. */
export type BlobContent = Uint8Array | Readable;

/**
 * Port of `IBlobContainer`. `.NET Stream`s become `Uint8Array` (plus `Readable` on input and `getStream` on output),
 * which keeps providers (memory, file system, S3) simple.
 */
export interface IBlobContainer {
  /** Saves a blob; throws `BlobAlreadyExistsException` when the name exists and `overrideExisting` is false. */
  save(name: string, content: BlobContent, overrideExisting?: boolean, signal?: AbortSignal): Promise<void>;
  /** Returns true if the blob was actually deleted, false if it did not exist. */
  delete(name: string, signal?: AbortSignal): Promise<boolean>;
  exists(name: string, signal?: AbortSignal): Promise<boolean>;
  /** Gets the blob bytes; throws when there is no blob with the given name. */
  get(name: string, signal?: AbortSignal): Promise<Uint8Array>;
  getOrNull(name: string, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  getStream(name: string, signal?: AbortSignal): Promise<Readable>;
  getStreamOrNull(name: string, signal?: AbortSignal): Promise<Readable | undefined>;
}
export const IBlobContainer = createToken<IBlobContainer>("IBlobContainer");

const knownContainerTypes = new Set<AbstractClass>();

/**
 * Token for `IBlobContainer<TContainer>`. The container has no open-generic registration, so the token must be
 * created before the service provider is built (a `static inject`, a module-level constant, or
 * {@link addBlobContainer} in `configureServices`); `AbpBlobStoringModule` registers every container type seen
 * here when it post-configures services. At runtime use `IBlobContainerFactory.create(ContainerClass)` instead.
 */
export function blobContainerToken(containerType: AbstractClass): ServiceToken<IBlobContainer> {
  knownContainerTypes.add(containerType);
  return keyedToken<IBlobContainer>(IBlobContainer, containerType);
}

/** Port of `services.AddTransient(typeof(IBlobContainer<>), typeof(BlobContainer<>))` for one container type. */
export function addBlobContainer(services: ServiceCollection, containerType: AbstractClass): void {
  const token = blobContainerToken(containerType);
  if (services.isRegistered(token)) return;
  services.addTransient(token, { useFactory: (provider) => provider.getRequired(IBlobContainerFactory).create(BlobContainerNameAttribute.getContainerName(containerType)) });
}

export function registerBlobContainers(services: ServiceCollection): void {
  for (const type of knownContainerTypes) addBlobContainer(services, type);
}

/** Port of `IBlobContainerFactory` (+ `Create<TContainer>()`). */
export interface IBlobContainerFactory {
  create(nameOrContainerType: string | AbstractClass): IBlobContainer;
}
export const IBlobContainerFactory = createToken<IBlobContainerFactory>("IBlobContainerFactory");

/** Port of `BlobContainerFactory`. */
@Transient(IBlobContainerFactory)
export class BlobContainerFactory implements IBlobContainerFactory {
  static readonly inject = [IBlobContainerConfigurationProvider, ICurrentTenant, ICancellationTokenProvider, IBlobProviderSelector, IServiceProviderToken, IBlobNormalizeNamingService] as const;

  constructor(
    protected readonly configurationProvider: IBlobContainerConfigurationProvider,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly cancellationTokenProvider: ICancellationTokenProvider,
    protected readonly providerSelector: IBlobProviderSelector,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly blobNormalizeNamingService: IBlobNormalizeNamingService,
  ) {}

  create(nameOrContainerType: string | AbstractClass): IBlobContainer {
    const name = typeof nameOrContainerType === "string" ? nameOrContainerType : BlobContainerNameAttribute.getContainerName(nameOrContainerType);
    const configuration = this.configurationProvider.get(name);
    return new BlobContainer(name, configuration, this.providerSelector.get(name), this.currentTenant, this.cancellationTokenProvider, this.blobNormalizeNamingService, this.serviceProvider);
  }
}

/** Port of `BlobContainer` (encryption is not ported; pipeline contributors work on bytes). */
export class BlobContainer implements IBlobContainer {
  constructor(
    protected readonly containerName: string,
    protected readonly configuration: BlobContainerConfiguration,
    protected readonly provider: IBlobProvider,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly cancellationTokenProvider: ICancellationTokenProvider,
    protected readonly blobNormalizeNamingService: IBlobNormalizeNamingService,
    protected readonly serviceProvider: IServiceProvider,
  ) {}

  async save(name: string, content: BlobContent, overrideExisting = false, signal?: AbortSignal): Promise<void> {
    const bytes = await toBytes(content);
    await this.currentTenant.run(this.getTenantIdOrNull(), undefined, async () => {
      const naming = this.normalizeNaming(name);
      const fallbackSignal = this.cancellationTokenProvider.fallbackToProvider(signal);
      const transformed = await this.runPipeline(naming, bytes, fallbackSignal, "saving");
      await this.provider.save(new BlobProviderSaveArgs(naming.containerName!, this.configuration, naming.blobName!, transformed, overrideExisting, fallbackSignal));
    });
  }

  async delete(name: string, signal?: AbortSignal): Promise<boolean> {
    return this.currentTenant.run(this.getTenantIdOrNull(), undefined, async () => {
      const naming = this.normalizeNaming(name);
      return this.provider.delete(new BlobProviderDeleteArgs(naming.containerName!, this.configuration, naming.blobName!, this.cancellationTokenProvider.fallbackToProvider(signal)));
    });
  }

  async exists(name: string, signal?: AbortSignal): Promise<boolean> {
    return this.currentTenant.run(this.getTenantIdOrNull(), undefined, async () => {
      const naming = this.normalizeNaming(name);
      return this.provider.exists(new BlobProviderExistsArgs(naming.containerName!, this.configuration, naming.blobName!, this.cancellationTokenProvider.fallbackToProvider(signal)));
    });
  }

  async get(name: string, signal?: AbortSignal): Promise<Uint8Array> {
    const bytes = await this.getOrNull(name, signal);
    if (bytes === undefined) throw new AbpException(`Could not find the requested BLOB '${name}' in the container '${this.containerName}'!`);
    return bytes;
  }

  async getOrNull(name: string, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    return this.currentTenant.run(this.getTenantIdOrNull(), undefined, async () => {
      const naming = this.normalizeNaming(name);
      const fallbackSignal = this.cancellationTokenProvider.fallbackToProvider(signal);
      const bytes = await this.provider.getOrNull(new BlobProviderGetArgs(naming.containerName!, this.configuration, naming.blobName!, fallbackSignal));
      if (bytes === undefined) return undefined;
      return this.runPipeline(naming, bytes, fallbackSignal, "getting");
    });
  }

  async getStream(name: string, signal?: AbortSignal): Promise<Readable> {
    return Readable.from(Buffer.from(await this.get(name, signal)));
  }

  async getStreamOrNull(name: string, signal?: AbortSignal): Promise<Readable | undefined> {
    const bytes = await this.getOrNull(name, signal);
    return bytes === undefined ? undefined : Readable.from(Buffer.from(bytes));
  }

  protected normalizeNaming(name: string): BlobNormalizeNaming {
    return this.blobNormalizeNamingService.normalizeNaming(this.configuration, this.containerName, name);
  }

  /** Contributors run in configuration order while saving and in reverse order while getting. */
  protected async runPipeline(naming: BlobNormalizeNaming, content: Uint8Array, signal: AbortSignal | undefined, phase: "saving" | "getting"): Promise<Uint8Array> {
    const contributorTypes = this.configuration.getEffectivePipelineContributors();
    if (contributorTypes.length === 0) return content;
    if (phase === "getting") contributorTypes.reverse();

    await using scope = this.serviceProvider.createScope();
    const context = new BlobPipelineContext(scope.serviceProvider, naming.containerName!, naming.blobName!, this.configuration, this.getTenantIdOrNull(), content, signal);
    for (const contributorType of contributorTypes) {
      const contributor = scope.serviceProvider.getRequired(contributorType);
      if (phase === "saving") await contributor.onSaving(context);
      else await contributor.onGetting(context);
    }
    return context.content;
  }

  protected getTenantIdOrNull(): Guid | undefined {
    if (!this.configuration.isMultiTenant) return undefined;
    return this.currentTenant.id;
  }
}

async function toBytes(content: BlobContent): Promise<Uint8Array> {
  if (content instanceof Uint8Array) return content;
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/* Port of `BlobContainerExtensions`. */

export function saveBytes(container: IBlobContainer, name: string, bytes: Uint8Array, overrideExisting = false, signal?: AbortSignal): Promise<void> {
  return container.save(name, bytes, overrideExisting, signal);
}

export function getAllBytes(container: IBlobContainer, name: string, signal?: AbortSignal): Promise<Uint8Array> {
  return container.get(name, signal);
}

export function getAllBytesOrNull(container: IBlobContainer, name: string, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  return container.getOrNull(name, signal);
}

export function saveText(container: IBlobContainer, name: string, text: string, overrideExisting = false, signal?: AbortSignal): Promise<void> {
  return container.save(name, new TextEncoder().encode(text), overrideExisting, signal);
}

export async function getText(container: IBlobContainer, name: string, signal?: AbortSignal): Promise<string> {
  return new TextDecoder().decode(await container.get(name, signal));
}

export async function getTextOrNull(container: IBlobContainer, name: string, signal?: AbortSignal): Promise<string | undefined> {
  const bytes = await container.getOrNull(name, signal);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

export { DefaultContainer };
