import { Check, Dependency, ILoggerFactory, Singleton, createToken, type ILogger } from "@abp/core";
import { SmsMessage } from "./sms-message.js";

/** Port of `ISmsSender`. */
export interface ISmsSender {
  send(smsMessage: SmsMessage): Promise<void>;
}
export const ISmsSender = createToken<ISmsSender>("ISmsSender");

/** Port of `SmsSenderExtensions.SendAsync(phoneNumber, text)`. */
export function sendSms(smsSender: ISmsSender, phoneNumber: string, text: string): Promise<void> {
  Check.notNull(smsSender, "smsSender");
  return smsSender.send(new SmsMessage(phoneNumber, text));
}

/** Port of `NullSmsSender`: logs the message instead of sending it; replaced by a real provider (`@abp/sms-aws`). */
@Dependency({ tryRegister: true })
@Singleton(ISmsSender)
export class NullSmsSender implements ISmsSender {
  static readonly inject = [ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(loggerFactory: ILoggerFactory) {
    this.logger = loggerFactory.createLogger(NullSmsSender.name);
  }

  async send(smsMessage: SmsMessage): Promise<void> {
    this.logger.warn(`SMS Sending was not implemented! Using ${NullSmsSender.name}:`, { phoneNumber: smsMessage.phoneNumber, text: smsMessage.text });
  }
}
