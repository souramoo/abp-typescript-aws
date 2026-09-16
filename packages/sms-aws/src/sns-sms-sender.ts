import { PublishCommand, SNSClient, type MessageAttributeValue } from "@aws-sdk/client-sns";
import { Dependency, Singleton, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { ISmsSender, type SmsMessage } from "@abp/sms";
import { AbpSnsSmsOptions, type SnsSmsType } from "./abp-sns-sms-options.js";

/** `SmsMessage.properties` keys that override the options per message. */
export const SnsSmsMessageProperties = {
  SmsType: "SmsType",
  SenderId: "SenderId",
} as const;

/** `ISmsSender` on SNS (`Publish` to a phone number). */
@Dependency({ replaceServices: true })
@Singleton(ISmsSender)
export class SnsSmsSender implements ISmsSender {
  static readonly inject = [optionsToken(AbpSnsSmsOptions)] as const;
  protected readonly options: AbpSnsSmsOptions;
  private client: SNSClient | undefined;

  constructor(options: IOptions<AbpSnsSmsOptions>) {
    this.options = options.value;
  }

  async send(smsMessage: SmsMessage): Promise<void> {
    await this.snsClient.send(new PublishCommand({ PhoneNumber: smsMessage.phoneNumber, Message: smsMessage.text, MessageAttributes: this.buildAttributes(smsMessage) }));
  }

  protected buildAttributes(smsMessage: SmsMessage): Record<string, MessageAttributeValue> {
    const smsType = stringProperty(smsMessage, SnsSmsMessageProperties.SmsType) ?? this.options.smsType;
    const senderId = stringProperty(smsMessage, SnsSmsMessageProperties.SenderId) ?? this.options.senderId;
    const attributes: Record<string, MessageAttributeValue> = { "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: smsType satisfies SnsSmsType | string } };
    if (!isNullOrWhiteSpace(senderId)) attributes["AWS.SNS.SMS.SenderID"] = { DataType: "String", StringValue: senderId };
    return attributes;
  }

  protected get snsClient(): SNSClient {
    this.client ??= this.options.createClient?.() ?? new SNSClient(this.options.region ? { region: this.options.region } : {});
    return this.client;
  }
}

function stringProperty(smsMessage: SmsMessage, name: string): string | undefined {
  const value = smsMessage.properties.get(name);
  return typeof value === "string" && !isNullOrWhiteSpace(value) ? value : undefined;
}
