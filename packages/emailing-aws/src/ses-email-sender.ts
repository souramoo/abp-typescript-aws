import { SESv2Client, SendEmailCommand, type SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import { Dependency, ILoggerFactory, Transient, optionsToken, type IOptions } from "@abp/core";
import { IBackgroundJobManager } from "@abp/background-jobs";
import { EmailSenderBase, IEmailSender, IEmailSenderConfiguration, type MailMessage } from "@abp/emailing";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpSesEmailingOptions } from "./abp-ses-emailing-options.js";
import { buildMimeMessage, encodeHeaderWord } from "./mime.js";

/** `IEmailSender` on Amazon SES v2 (the MailKit/SMTP sender role): simple content, or raw MIME when attachments exist. */
@Dependency({ replaceServices: true })
@Transient(IEmailSender)
export class SesEmailSender extends EmailSenderBase {
  static override readonly inject = [ICurrentTenant, IEmailSenderConfiguration, IBackgroundJobManager, ILoggerFactory, optionsToken(AbpSesEmailingOptions)] as const;
  protected readonly options: AbpSesEmailingOptions;
  private client: SESv2Client | undefined;

  constructor(currentTenant: ICurrentTenant, configuration: IEmailSenderConfiguration, backgroundJobManager: IBackgroundJobManager, loggerFactory: ILoggerFactory, options: IOptions<AbpSesEmailingOptions>) {
    super(currentTenant, configuration, backgroundJobManager, loggerFactory);
    this.options = options.value;
  }

  protected async sendEmail(mail: MailMessage): Promise<void> {
    await this.sesClient.send(new SendEmailCommand(this.buildRequest(mail)));
  }

  protected buildRequest(mail: MailMessage): SendEmailCommandInput {
    const request: SendEmailCommandInput = {
      FromEmailAddress: this.formatFrom(mail),
      Destination: { ToAddresses: mail.to, CcAddresses: mail.cc.length > 0 ? mail.cc : undefined, BccAddresses: mail.bcc.length > 0 ? mail.bcc : undefined },
      ConfigurationSetName: this.options.configurationSetName,
      Content:
        mail.attachments.length > 0
          ? { Raw: { Data: new TextEncoder().encode(buildMimeMessage(mail)) } }
          : {
              Simple: {
                Subject: { Data: mail.subject ?? "", Charset: "UTF-8" },
                Body: mail.isBodyHtml ? { Html: { Data: mail.body ?? "", Charset: "UTF-8" } } : { Text: { Data: mail.body ?? "", Charset: "UTF-8" } },
              },
            },
    };
    return request;
  }

  protected formatFrom(mail: MailMessage): string | undefined {
    if (!mail.from) return undefined;
    if (!mail.from.displayName) return mail.from.address;
    const name = encodeHeaderWord(mail.from.displayName);
    return name === mail.from.displayName ? `"${name.replace(/["\\]/g, "\\$&")}" <${mail.from.address}>` : `${name} <${mail.from.address}>`;
  }

  protected get sesClient(): SESv2Client {
    this.client ??= this.options.createClient?.() ?? new SESv2Client(this.options.region ? { region: this.options.region } : {});
    return this.client;
  }
}
