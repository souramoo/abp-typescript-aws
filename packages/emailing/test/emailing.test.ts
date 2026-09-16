import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Transient } from "@abp/core";
import { AbpBackgroundJobOptions, IBackgroundJobExecuter, IBackgroundJobManager, IBackgroundJobSerializer, NullBackgroundJobManager, type BackgroundJobPriority, type IBackgroundJobManager as IBackgroundJobManagerType, type JobArgsOrJobType } from "@abp/background-jobs";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ISettingDefinitionManager, ISettingProvider } from "@abp/settings";
import { ITemplateRenderer } from "@abp/text-templating";
import {
  AbpEmailingModule,
  BackgroundEmailSendingJobArgs,
  EmailSenderBase,
  EmailSettingNames,
  IEmailSender,
  IEmailSenderConfiguration,
  ISmtpEmailSenderConfiguration,
  NullEmailSender,
  StandardEmailTemplates,
  type MailMessage,
} from "../src/index.js";

class RecordingJobManager implements IBackgroundJobManagerType {
  readonly enqueued: { name: string; args: object; priority?: BackgroundJobPriority; delayMs?: number }[] = [];
  async enqueue<TArgs extends object>(argsType: JobArgsOrJobType<TArgs>, args: TArgs, priority?: BackgroundJobPriority, delayMs?: number): Promise<string> {
    this.enqueued.push({ name: (argsType as { name: string }).name, args, priority, delayMs });
    return "job-1";
  }
}

@Transient()
class RecordingEmailSender extends EmailSenderBase {
  static readonly sent: MailMessage[] = [];
  static override readonly inject = EmailSenderBase.inject;
  protected async sendEmail(mail: MailMessage): Promise<void> {
    RecordingEmailSender.sent.push(mail);
  }
}

@DependsOn(AbpEmailingModule)
class TestModule extends AbpModule {}

const tenantId = "11111111-1111-4111-8111-111111111111";

async function createApp(options: { jobManager?: RecordingJobManager; sender?: boolean } = {}) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance, skipConfigureServices: true });
  if (options.jobManager) app.services.addSingleton(IBackgroundJobManager, { useValue: options.jobManager });
  if (options.sender) app.services.addTransient(IEmailSender, RecordingEmailSender);
  await app.configureServices();
  await app.initialize();
  RecordingEmailSender.sent.length = 0;
  return app;
}

describe("emailing", () => {
  it("defines the mailing settings with .NET defaults and registers the localization resource", async () => {
    const app = await createApp();
    const definitions = await app.serviceProvider.getRequired(ISettingDefinitionManager).getAll();
    const names = definitions.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining([EmailSettingNames.DefaultFromAddress, EmailSettingNames.Smtp.Host, EmailSettingNames.Smtp.Password]));
    expect(definitions.find((d) => d.name === EmailSettingNames.Smtp.Password)?.isEncrypted).toBe(true);
    const settingProvider = app.serviceProvider.getRequired(ISettingProvider);
    expect(await settingProvider.getOrNull(EmailSettingNames.DefaultFromAddress)).toBe("noreply@abp.io");
    expect(await settingProvider.getOrNull(EmailSettingNames.DefaultFromDisplayName)).toBe("ABP application");
    const configuration = app.serviceProvider.getRequired(IEmailSenderConfiguration);
    expect(await configuration.getDefaultFromAddress()).toBe("noreply@abp.io");
    const smtp = app.serviceProvider.getRequired(ISmtpEmailSenderConfiguration);
    expect(await smtp.getPort()).toBe(25);
    expect(await smtp.getUseDefaultCredentials()).toBe(true);
    await expect(smtp.getUserName()).rejects.toThrow("null or empty");
  });

  it("uses NullEmailSender by default and normalizes the sender address", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getRequired(IEmailSender)).toBeInstanceOf(NullEmailSender);
    expect(app.serviceProvider.getRequired(IBackgroundJobManager)).toBeInstanceOf(NullBackgroundJobManager);
  });

  it("sends directly when no background job manager is available", async () => {
    const app = await createApp({ sender: true });
    const sender = app.serviceProvider.getRequired(IEmailSender);
    await sender.queue({ to: "john@example.com", subject: "Hi", body: "<b>x</b>", cc: ["cc@example.com"], attachments: [{ name: "a.txt", file: new TextEncoder().encode("abc") }] });
    expect(RecordingEmailSender.sent).toHaveLength(1);
    const mail = RecordingEmailSender.sent[0]!;
    expect(mail.from?.address).toBe("noreply@abp.io");
    expect(mail.from?.displayName).toBe("ABP application");
    expect(mail.to).toEqual(["john@example.com"]);
    expect(mail.cc).toEqual(["cc@example.com"]);
    expect(mail.attachments[0]?.name).toBe("a.txt");
    expect(mail.isBodyHtml).toBe(true);
    await expect(sender.queue({ to: "not-an-email", subject: "x", body: "y" })).rejects.toThrow("is not valid");
  });

  it("queues a BackgroundEmailSendingJob that sends through the email sender when executed", async () => {
    const jobManager = new RecordingJobManager();
    const app = await createApp({ jobManager, sender: true });
    const sender = app.serviceProvider.getRequired(IEmailSender);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    await currentTenant.run(tenantId, undefined, () => sender.queue({ from: "me@example.com", to: "john@example.com", subject: "Hi", body: "Body", isBodyHtml: false, attachments: [{ name: "a.bin", file: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream" }] }));

    expect(jobManager.enqueued).toHaveLength(1);
    expect(RecordingEmailSender.sent).toHaveLength(0);
    const args = jobManager.enqueued[0]!.args as BackgroundEmailSendingJobArgs;
    expect(args).toBeInstanceOf(BackgroundEmailSendingJobArgs);
    expect(args.tenantId).toBe(tenantId);
    expect(args.attachments?.[0]?.fileBase64).toBe(Buffer.from([1, 2, 3]).toString("base64"));

    const jobOptions = app.serviceProvider.getOptions(AbpBackgroundJobOptions);
    const jobName = jobOptions.getBackgroundJobName(BackgroundEmailSendingJobArgs);
    expect(jobName).toBe("Abp.Emailing.BackgroundEmailSendingJob");
    const serialized = app.serviceProvider.getRequired(IBackgroundJobSerializer).serialize(args);
    await app.serviceProvider.getRequired(IBackgroundJobExecuter).executeSerialized(jobName, serialized);

    expect(RecordingEmailSender.sent).toHaveLength(1);
    const mail = RecordingEmailSender.sent[0]!;
    expect(mail.from?.address).toBe("me@example.com");
    expect(mail.isBodyHtml).toBe(false);
    expect(mail.attachments[0]?.file).toEqual(new Uint8Array([1, 2, 3]));
    expect(mail.attachments[0]?.contentType).toBe("application/octet-stream");
  });

  it("renders the standard message template inside the standard layout", async () => {
    const app = await createApp();
    const renderer = app.serviceProvider.getRequired(ITemplateRenderer);
    const html = await renderer.render(StandardEmailTemplates.Message, { message: "Hello <b>World</b>" }, "en");
    expect(html).toContain('<html lang="en" dir="ltr"');
    expect(html).toContain("Hello <b>World</b>");
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
