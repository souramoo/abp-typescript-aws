import { DisableAuditing } from "@abp/auditing";
import { z } from "zod";

/** Port of `EmailSettingsDto`. */
export class EmailSettingsDto {
  smtpHost: string | undefined = undefined;
  smtpPort = 0;
  smtpUserName: string | undefined = undefined;
  smtpPassword: string | undefined = undefined;
  smtpDomain: string | undefined = undefined;
  smtpEnableSsl = false;
  smtpUseDefaultCredentials = false;
  defaultFromAddress: string | undefined = undefined;
  defaultFromDisplayName: string | undefined = undefined;
}

/** Port of `UpdateEmailSettingsDto` (the data annotations become the zod schema). */
export class UpdateEmailSettingsDto {
  static readonly schema = z.object({
    smtpHost: z.string().max(256).nullish(),
    smtpPort: z.number().int().min(1).max(65535),
    smtpUserName: z.string().max(1024).nullish(),
    smtpPassword: z.string().max(1024).nullish(),
    smtpDomain: z.string().max(1024).nullish(),
    smtpEnableSsl: z.boolean().default(false),
    smtpUseDefaultCredentials: z.boolean().default(false),
    defaultFromAddress: z.string().min(1).max(1024),
    defaultFromDisplayName: z.string().min(1).max(1024),
  });

  smtpHost: string | null | undefined = undefined;
  smtpPort = 25;
  smtpUserName: string | null | undefined = undefined;
  @DisableAuditing()
  smtpPassword: string | null | undefined = undefined;
  smtpDomain: string | null | undefined = undefined;
  smtpEnableSsl = false;
  smtpUseDefaultCredentials = false;
  defaultFromAddress = "";
  defaultFromDisplayName = "";
}

/** Port of `SendTestEmailInput`. */
export class SendTestEmailInput {
  static readonly schema = z.object({
    senderEmailAddress: z.string().min(1),
    targetEmailAddress: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().nullish(),
  });

  senderEmailAddress = "";
  targetEmailAddress = "";
  subject = "";
  body: string | null | undefined = undefined;
}
