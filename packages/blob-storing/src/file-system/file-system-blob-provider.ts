import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transient, createToken, delay } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { BlobAlreadyExistsException, BlobProviderBase, IBlobProvider, type BlobProviderArgs, type BlobProviderDeleteArgs, type BlobProviderExistsArgs, type BlobProviderGetArgs, type BlobProviderSaveArgs } from "../blob-provider.js";

/** Port of `IBlobFilePathCalculator`. */
export interface IBlobFilePathCalculator {
  calculate(args: BlobProviderArgs): string;
}
export const IBlobFilePathCalculator = createToken<IBlobFilePathCalculator>("IBlobFilePathCalculator");

/** Port of `DefaultBlobFilePathCalculator`: `{basePath}/host|tenants/{tenantId}/[{container}/]{blob}`. */
@Transient(IBlobFilePathCalculator)
export class DefaultBlobFilePathCalculator implements IBlobFilePathCalculator {
  static readonly inject = [ICurrentTenant] as const;

  constructor(protected readonly currentTenant: ICurrentTenant) {}

  calculate(args: BlobProviderArgs): string {
    const fileSystemConfiguration = args.configuration.getFileSystemConfiguration();
    let blobPath = fileSystemConfiguration.basePath;
    blobPath = this.currentTenant.id === undefined ? join(blobPath, "host") : join(blobPath, "tenants", this.currentTenant.id);
    if (fileSystemConfiguration.appendContainerNameToBasePath) blobPath = join(blobPath, args.containerName);
    return join(blobPath, args.blobName);
  }
}

function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined;
}

/** Port of the Polly `WaitAndRetryAsync(2, n => n seconds)` policy on I/O errors. */
async function retryOnIoError<T>(action: () => Promise<T>, nonRetryableCodes: readonly string[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (e) {
      const code = errorCode(e);
      if (code === undefined || nonRetryableCodes.includes(code) || attempt >= 2) throw e;
      await delay((attempt + 1) * 1000);
    }
  }
}

/** Port of `FileSystemBlobProvider`. */
@Transient(IBlobProvider)
export class FileSystemBlobProvider extends BlobProviderBase {
  static readonly inject = [IBlobFilePathCalculator] as const;

  constructor(protected readonly filePathCalculator: IBlobFilePathCalculator) {
    super();
  }

  override async save(args: BlobProviderSaveArgs): Promise<void> {
    const filePath = this.filePathCalculator.calculate(args);
    if (!args.overrideExisting && (await this.fileExists(filePath))) {
      throw new BlobAlreadyExistsException(`Saving BLOB '${args.blobName}' does already exists in the container '${args.containerName}'! Set overrideExisting if it should be overwritten.`);
    }
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await retryOnIoError(() => writeFile(filePath, args.blobContent, { flag: args.overrideExisting ? "w" : "wx", signal: args.signal }), ["EEXIST", "ABORT_ERR"]);
    } catch (e) {
      if (errorCode(e) === "EEXIST") {
        throw new BlobAlreadyExistsException(`Saving BLOB '${args.blobName}' does already exists in the container '${args.containerName}'! Set overrideExisting if it should be overwritten.`, { cause: e });
      }
      throw e;
    }
  }

  override async delete(args: BlobProviderDeleteArgs): Promise<boolean> {
    const filePath = this.filePathCalculator.calculate(args);
    if (!(await this.fileExists(filePath))) return false;
    await rm(filePath, { force: true });
    return true;
  }

  override async exists(args: BlobProviderExistsArgs): Promise<boolean> {
    return this.fileExists(this.filePathCalculator.calculate(args));
  }

  override async getOrNull(args: BlobProviderGetArgs): Promise<Uint8Array | undefined> {
    const filePath = this.filePathCalculator.calculate(args);
    if (!(await this.fileExists(filePath))) return undefined;
    return retryOnIoError(() => readFile(filePath, { signal: args.signal }), ["ENOENT", "ABORT_ERR"]);
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch (e) {
      if (errorCode(e) === "ENOENT") return false;
      throw e;
    }
  }
}
