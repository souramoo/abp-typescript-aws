import { ArgumentException, Dependency, ILoggerFactory, Transient, createToken, isNullOrEmptyString, isNullOrWhiteSpace, type ILogger, type ServiceKey } from "@abp/core";
import { IBackgroundJobManager, isBackgroundJobManagerAvailable } from "@abp/background-jobs";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { BackgroundEmailSendingJobArgs } from "./background-email-sending-job-args.js";
import { MailAddress, MailMessage, type AdditionalEmailSendingArgs, type EmailSendArgs } from "./email-message.js";
import { IEmailSenderConfiguration } from "./email-sender-configuration.js";

/** Port of `IEmailSender`. */
export interface IEmailSender {
  /** Sends an email. */
  send(args: EmailSendArgs): Promise<void>;
  /** Sends a mail message; `normalize` fills the sender from the settings when it is missing. */
  sendMail(mail: MailMessage, normalize?: boolean): Promise<void>;
  /** Adds an email to the queue to send it via background jobs (sends directly when no job manager is available). */
  queue(args: EmailSendArgs): Promise<void>;
}
export const IEmailSender = createToken<IEmailSender>("IEmailSender");

/**
 * Port of `ISmtpEmailSender`. Only the contract is ported: there is no SMTP client in the serverless runtime,
 * `@abp/emailing-aws` (SES) is the shipped implementation.
 */
export type ISmtpEmailSender = IEmailSender;
export const ISmtpEmailSender = createToken<ISmtpEmailSender>("ISmtpEmailSender");

const emailAddressPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Port of `EmailSenderBase`: the base class to implement `IEmailSender`. */
export abstract class EmailSenderBase implements IEmailSender {
  static readonly inject: readonly ServiceKey[] = [ICurrentTenant, IEmailSenderConfiguration, IBackgroundJobManager, ILoggerFactory];
  protected readonly logger: ILogger;

  constructor(
    protected readonly currentTenant: ICurrentTenant,
    protected readonly configuration: IEmailSenderConfiguration,
    protected readonly backgroundJobManager: IBackgroundJobManager,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(new.target.name);
  }

  async send(args: EmailSendArgs): Promise<void> {
    await this.sendMail(this.buildMailMessage(args));
  }

  async sendMail(mail: MailMessage, normalize = true): Promise<void> {
    if (normalize) await this.normalizeMail(mail);
    await this.sendEmail(mail);
  }

  async queue(args: EmailSendArgs): Promise<void> {
    this.validateEmailAddress(args.to);

    if (!isBackgroundJobManagerAvailable(this.backgroundJobManager)) {
      await this.send(args);
      return;
    }

    await this.backgroundJobManager.enqueue(
      BackgroundEmailSendingJobArgs,
      new BackgroundEmailSendingJobArgs({
        tenantId: this.currentTenant.id,
        from: isNullOrWhiteSpace(args.from) ? undefined : args.from,
        to: args.to,
        subject: args.subject,
        body: args.body,
        isBodyHtml: args.isBodyHtml ?? true,
        ...BackgroundEmailSendingJobArgs.serializeAdditionalArgs(args),
      }),
    );
  }

  protected buildMailMessage(args: EmailSendArgs): MailMessage {
    const message = new MailMessage();
    if (!isNullOrWhiteSpace(args.from)) message.from = new MailAddress(args.from);
    message.to.push(args.to);
    message.subject = args.subject;
    message.body = args.body;
    message.isBodyHtml = args.isBodyHtml ?? true;
    this.applyAdditionalArgs(message, args);
    return message;
  }

  protected applyAdditionalArgs(message: MailMessage, additional: AdditionalEmailSendingArgs | undefined): void {
    if (!additional) return;
    for (const attachment of additional.attachments ?? []) if (attachment.file) message.attachments.push(attachment);
    message.cc.push(...(additional.cc ?? []));
    message.bcc.push(...(additional.bcc ?? []));
  }

  /** Implement this to send the email in derived classes. */
  protected abstract sendEmail(mail: MailMessage): Promise<void>;

  /** Port of `NormalizeMailAsync`: fills `from` from the configuration when missing (encodings are always UTF-8 here). */
  protected async normalizeMail(mail: MailMessage): Promise<void> {
    if (mail.from === undefined || isNullOrEmptyString(mail.from.address)) {
      mail.from = new MailAddress(await this.configuration.getDefaultFromAddress(), await this.configuration.getDefaultFromDisplayName());
    }
  }

  protected validateEmailAddress(emailAddress: string): void {
    if (!emailAddressPattern.test(emailAddress)) throw new ArgumentException(`Email address '${emailAddress}' is not valid!`);
  }
}

/**
 * Port of `NullEmailSender`: logs emails instead of sending them. Unlike .NET (where the SMTP sender is the default)
 * it is the registered `IEmailSender` until a provider such as `@abp/emailing-aws` replaces it.
 */
@Dependency({ tryRegister: true })
@Transient(IEmailSender)
export class NullEmailSender extends EmailSenderBase {
  static override readonly inject = [ICurrentTenant, IEmailSenderConfiguration, IBackgroundJobManager, ILoggerFactory] as const;

  protected async sendEmail(mail: MailMessage): Promise<void> {
    this.logger.warn("USING NullEmailSender!");
    this.logger.debug("sendEmail:", { to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.body });
  }
}
