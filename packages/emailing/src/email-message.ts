/** Port of `EmailAttachment` (`File` is `Uint8Array` here). */
export interface EmailAttachment {
  name: string;
  file: Uint8Array;
  /** MIME type of the attachment; providers default to `application/octet-stream`. */
  contentType?: string;
}

/** Port of `AdditionalEmailSendingArgs` (+ `bcc`, which `MailMessage` supports in .NET). */
export interface AdditionalEmailSendingArgs {
  cc?: string[];
  bcc?: string[];
  attachments?: EmailAttachment[];
  extraProperties?: Record<string, unknown>;
}

/** The arguments of `IEmailSender.send`/`queue` (the .NET positional overloads collapse into one object). */
export interface EmailSendArgs extends AdditionalEmailSendingArgs {
  to: string;
  subject?: string;
  body?: string;
  /** Default: true. */
  isBodyHtml?: boolean;
  from?: string;
}

/** Port of `System.Net.Mail.MailAddress`. */
export class MailAddress {
  constructor(
    readonly address: string,
    readonly displayName: string | undefined = undefined,
  ) {}

  /** `"Display Name" <address>` or the bare address. */
  toString(): string {
    return this.displayName ? `"${this.displayName.replace(/"/g, "'")}" <${this.address}>` : this.address;
  }
}

/** Port of `System.Net.Mail.MailMessage`: the normalized message a sender implementation receives. */
export class MailMessage {
  from: MailAddress | undefined;
  readonly to: string[] = [];
  readonly cc: string[] = [];
  readonly bcc: string[] = [];
  subject: string | undefined;
  body: string | undefined;
  isBodyHtml = true;
  readonly attachments: EmailAttachment[] = [];
  readonly headers = new Map<string, string>();
}
