import type { SESv2Client } from "@aws-sdk/client-sesv2";

/** Options of the SES email sender (configuration section `Emailing:Aws`). */
export class AbpSesEmailingOptions {
  /** AWS region of the SES client; when unset the SDK resolves it (`AWS_REGION`). */
  region: string | undefined;
  /** The SES configuration set applied to every message. */
  configurationSetName: string | undefined;
  /** Overrides the lazily created `SESv2Client`. */
  createClient: (() => SESv2Client) | undefined;
}
