import { Transient } from "@abp/core";
import { AsyncBackgroundJob, BackgroundJob } from "@abp/background-jobs";
import { BackgroundEmailSendingJobArgs } from "./background-email-sending-job-args.js";
import { IEmailSender } from "./email-sender.js";

/** Port of `BackgroundEmailSendingJob`. */
@Transient()
@BackgroundJob(BackgroundEmailSendingJobArgs)
export class BackgroundEmailSendingJob extends AsyncBackgroundJob<BackgroundEmailSendingJobArgs> {
  static readonly inject = [IEmailSender] as const;

  constructor(protected readonly emailSender: IEmailSender) {
    super();
  }

  async execute(args: BackgroundEmailSendingJobArgs): Promise<void> {
    const typed = args instanceof BackgroundEmailSendingJobArgs ? args : new BackgroundEmailSendingJobArgs(args);
    await this.emailSender.send({
      from: typed.from,
      to: typed.to,
      subject: typed.subject,
      body: typed.body,
      isBodyHtml: typed.isBodyHtml,
      ...typed.toAdditionalArgs(),
    });
  }
}
