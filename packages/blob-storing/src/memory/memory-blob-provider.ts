import { Singleton } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { BlobAlreadyExistsException, BlobProviderBase, IBlobProvider, type BlobProviderArgs, type BlobProviderDeleteArgs, type BlobProviderExistsArgs, type BlobProviderGetArgs, type BlobProviderSaveArgs } from "../blob-provider.js";

/**
 * Port of `MemoryBlobProvider`. Registered as a singleton (the .NET class is transient, which would give every
 * container its own empty store) so all containers of the process share one in-memory store.
 */
@Singleton(IBlobProvider)
export class MemoryBlobProvider extends BlobProviderBase {
  static readonly inject = [ICurrentTenant] as const;
  protected readonly memoryStore = new Map<string, Uint8Array>();

  constructor(protected readonly currentTenant: ICurrentTenant) {
    super();
  }

  override async save(args: BlobProviderSaveArgs): Promise<void> {
    const cacheKey = this.getCacheKey(args);
    const bytes = new Uint8Array(args.blobContent);
    if (!args.overrideExisting && this.memoryStore.has(cacheKey)) {
      throw new BlobAlreadyExistsException(`Saving BLOB '${args.blobName}' does already exists in the container '${args.containerName}'! Set overrideExisting if it should be overwritten.`);
    }
    this.memoryStore.set(cacheKey, bytes);
  }

  override async delete(args: BlobProviderDeleteArgs): Promise<boolean> {
    return this.memoryStore.delete(this.getCacheKey(args));
  }

  override async exists(args: BlobProviderExistsArgs): Promise<boolean> {
    return this.memoryStore.has(this.getCacheKey(args));
  }

  override async getOrNull(args: BlobProviderGetArgs): Promise<Uint8Array | undefined> {
    const bytes = this.memoryStore.get(this.getCacheKey(args));
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  protected getCacheKey(args: BlobProviderArgs): string {
    return `${this.currentTenant.id ?? ""}_${args.blobName}_${args.containerName}`;
  }
}
