import type { SNSClient } from "@aws-sdk/client-sns";

export type SnsSmsType = "Transactional" | "Promotional";

/** Options of the SNS SMS sender (configuration section `Sms:Aws`). */
export class AbpSnsSmsOptions {
  /** AWS region of the SNS client; when unset the SDK resolves it (`AWS_REGION`). */
  region: string | undefined;
  /** The `AWS.SNS.SMS.SMSType` attribute. Default: `Transactional`. */
  smsType: SnsSmsType = "Transactional";
  /** The `AWS.SNS.SMS.SenderID` attribute (where supported by the destination country). */
  senderId: string | undefined;
  /** Overrides the lazily created `SNSClient`. */
  createClient: (() => SNSClient) | undefined;
}
