import { Check } from "@abp/core";

/** Port of `SmsMessage`. */
export class SmsMessage {
  readonly phoneNumber: string;
  readonly text: string;
  readonly properties = new Map<string, unknown>();

  constructor(phoneNumber: string, text: string) {
    this.phoneNumber = Check.notNullOrWhiteSpace(phoneNumber, "phoneNumber");
    this.text = Check.notNullOrWhiteSpace(text, "text");
  }
}
