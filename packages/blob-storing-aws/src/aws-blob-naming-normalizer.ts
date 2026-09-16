import { Transient } from "@abp/core";
import type { IBlobNamingNormalizer } from "@abp/blob-storing";

/** Port of `AwsBlobNamingNormalizer`: makes a container name a valid S3 bucket name. */
@Transient()
export class AwsBlobNamingNormalizer implements IBlobNamingNormalizer {
  /** https://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html */
  normalizeContainerName(containerName: string): string {
    let name = containerName.toLowerCase();
    if (name.length > 63) name = name.slice(0, 63);
    name = name.replace(/[^a-z0-9-.]/g, "");
    name = name.replace(/\.{2,}/g, ".");
    name = name.replace(/-\./g, "");
    name = name.replace(/\.-/g, "");
    name = name.replace(/^-/, "");
    name = name.replace(/-$/, "");
    name = name.replace(/^\./, "");
    name = name.replace(/\.$/, "");
    name = name.replace(/^(?:(?:^|\.)(?:2(?:5[0-5]|[0-4]\d)|1?\d?\d)){4}$/, "");
    while (name.length < 3) name += "0";
    return name;
  }

  /** https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html */
  normalizeBlobName(blobName: string): string {
    return blobName;
  }
}
