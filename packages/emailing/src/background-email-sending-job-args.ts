import { BackgroundJobName } from "@abp/background-jobs";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { AdditionalEmailSendingArgs, EmailAttachment } from "./email-message.js";

/** An attachment as it travels through the JSON job queue (bytes are base64). */
export interface SerializedEmailAttachment {
  name: string;
  fileBase64: string;
  contentType?: string;
}

/** Port of `BackgroundEmailSendingJobArgs` (`AdditionalEmailSendingArgs` is flattened and attachments are base64). */
@BackgroundJobName("Abp.Emailing.BackgroundEmailSendingJob")
export class BackgroundEmailSendingJobArgs implements IMultiTenant {
  tenantId: string | null | undefined = undefined;
  from: string | undefined = undefined;
  to = "";
  subject: string | undefined = undefined;
  body: string | undefined = undefined;
  /** Default: true. */
  isBodyHtml = true;
  cc: string[] | undefined = undefined;
  bcc: string[] | undefined = undefined;
  attachments: SerializedEmailAttachment[] | undefined = undefined;
  extraProperties: Record<string, unknown> | undefined = undefined;

  constructor(init: Partial<BackgroundEmailSendingJobArgs> = {}) {
    Object.assign(this, init);
  }

  static serializeAdditionalArgs(args: AdditionalEmailSendingArgs | undefined): Pick<BackgroundEmailSendingJobArgs, "cc" | "bcc" | "attachments" | "extraProperties"> {
    return {
      cc: args?.cc,
      bcc: args?.bcc,
      attachments: args?.attachments?.map((a) => ({ name: a.name, fileBase64: Buffer.from(a.file).toString("base64"), contentType: a.contentType })),
      extraProperties: args?.extraProperties,
    };
  }

  toAdditionalArgs(): AdditionalEmailSendingArgs {
    const attachments: EmailAttachment[] | undefined = this.attachments?.map((a) => ({ name: a.name, file: new Uint8Array(Buffer.from(a.fileBase64, "base64")), contentType: a.contentType }));
    return { cc: this.cc, bcc: this.bcc, attachments, extraProperties: this.extraProperties };
  }
}
