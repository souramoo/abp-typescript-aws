import { Transient } from "@abp/core";
import type { IBlobNamingNormalizer } from "../blob-naming.js";

/**
 * Port of `FileSystemBlobNamingNormalizer`: on Windows removes the characters a file name cannot contain
 * (`: * ? " < > |`; `/` and `\` are kept so a blob name may include directories).
 */
@Transient()
export class FileSystemBlobNamingNormalizer implements IBlobNamingNormalizer {
  constructor(protected readonly platform: NodeJS.Platform = process.platform) {}

  normalizeContainerName(containerName: string): string {
    return this.normalize(containerName);
  }

  normalizeBlobName(blobName: string): string {
    return this.normalize(blobName);
  }

  protected normalize(fileName: string): string {
    if (this.platform === "win32") return fileName.replace(/[:*?"<>|]/g, "");
    return fileName;
  }
}
