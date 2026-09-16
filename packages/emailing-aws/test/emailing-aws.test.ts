import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { IEmailSender, MailAddress, MailMessage, NullEmailSender } from "@abp/emailing";
import { AbpEmailingAwsModule, AbpSesEmailingOptions, SesEmailSender, buildMimeMessage, encodeHeaderWord } from "../src/index.js";

const sesMock = mockClient(SESv2Client);

@DependsOn(AbpEmailingAwsModule)
class TestModule extends AbpModule {}

async function createApp(values: Record<string, unknown> = {}) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("SES email sender", () => {
  beforeEach(() => sesMock.reset());

  it("replaces the null sender and sends simple html content with the normalized sender", async () => {
    const app = await createApp({ Emailing: { Aws: { Region: "us-east-1", ConfigurationSetName: "prod" } } });
    const sender = app.serviceProvider.getRequired(IEmailSender);
    expect(sender).toBeInstanceOf(SesEmailSender);
    expect(sender).not.toBeInstanceOf(NullEmailSender);
    expect(app.serviceProvider.getOptions(AbpSesEmailingOptions)).toMatchObject({ region: "us-east-1", configurationSetName: "prod" });
    sesMock.on(SendEmailCommand).resolves({ MessageId: "1" });

    await sender.send({ to: "john@example.com", subject: "Hi", body: "<b>x</b>", cc: ["cc@example.com"], bcc: ["bcc@example.com"] });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input;
    expect(input.FromEmailAddress).toBe('"ABP application" <noreply@abp.io>');
    expect(input.Destination).toEqual({ ToAddresses: ["john@example.com"], CcAddresses: ["cc@example.com"], BccAddresses: ["bcc@example.com"] });
    expect(input.ConfigurationSetName).toBe("prod");
    expect(input.Content?.Simple).toEqual({ Subject: { Data: "Hi", Charset: "UTF-8" }, Body: { Html: { Data: "<b>x</b>", Charset: "UTF-8" } } });
  });

  it("sends plain text bodies and keeps an explicit sender", async () => {
    const app = await createApp();
    sesMock.on(SendEmailCommand).resolves({});
    await app.serviceProvider.getRequired(IEmailSender).send({ from: "me@example.com", to: "a@example.com", subject: "Ünïcode", body: "plain", isBodyHtml: false });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input;
    expect(input.FromEmailAddress).toBe("me@example.com");
    expect(input.Content?.Simple?.Body).toEqual({ Text: { Data: "plain", Charset: "UTF-8" } });
    expect(input.Destination?.CcAddresses).toBeUndefined();
  });

  it("sends raw MIME when there are attachments", async () => {
    const app = await createApp();
    sesMock.on(SendEmailCommand).resolves({});
    await app.serviceProvider.getRequired(IEmailSender).send({ to: "a@example.com", subject: "Report", body: "<p>see attached</p>", attachments: [{ name: "r.csv", file: new TextEncoder().encode("a,b\n1,2"), contentType: "text/csv" }] });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input;
    expect(input.Content?.Simple).toBeUndefined();
    const raw = new TextDecoder().decode(input.Content?.Raw?.Data);
    expect(raw).toContain('From: "ABP application" <noreply@abp.io>\r\n');
    expect(raw).toContain("To: a@example.com\r\n");
    expect(raw).toContain("Subject: Report\r\n");
    expect(raw).toContain("Content-Type: multipart/mixed; boundary=");
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(raw).toContain(Buffer.from("<p>see attached</p>").toString("base64"));
    expect(raw).toContain('Content-Type: text/csv; name="r.csv"');
    expect(raw).toContain('Content-Disposition: attachment; filename="r.csv"');
    expect(raw).toContain(Buffer.from("a,b\n1,2").toString("base64"));
    expect(input.Destination?.ToAddresses).toEqual(["a@example.com"]);
  });

  it("builds RFC 2047 headers for non-ASCII values and omits Bcc from the raw headers", () => {
    expect(encodeHeaderWord("plain")).toBe("plain");
    expect(encodeHeaderWord("Ünïcode")).toBe(`=?UTF-8?B?${Buffer.from("Ünïcode").toString("base64")}?=`);
    const mail = new MailMessage();
    mail.from = new MailAddress("me@example.com", "Ayşe");
    mail.to.push("a@example.com");
    mail.bcc.push("hidden@example.com");
    mail.subject = "Merhaba dünya";
    mail.body = "x";
    mail.attachments.push({ name: 'we"ird.txt', file: new Uint8Array(100) });
    const raw = buildMimeMessage(mail, "B");
    expect(raw).toContain(`From: =?UTF-8?B?${Buffer.from("Ayşe").toString("base64")}?= <me@example.com>`);
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Merhaba dünya").toString("base64")}?=`);
    expect(raw).not.toContain("hidden@example.com");
    expect(raw).toContain('name="we_ird.txt"');
    expect(raw.endsWith("--B--\r\n")).toBe(true);
    const base64Line = raw.split("\r\n").find((l) => l.startsWith("AAAA"));
    expect(base64Line?.length).toBe(76);
  });
});
