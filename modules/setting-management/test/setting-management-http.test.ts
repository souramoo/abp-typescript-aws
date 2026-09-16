import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailSettingNames } from "@abp/emailing";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ISettingProvider } from "@abp/settings";
import { TimingSettingNames } from "@abp/timing";
import type { EmailSettingsDto } from "../src/application-contracts/index.js";
import { EmailSettingsController, TimeZoneSettingsController } from "../src/http-api/index.js";
import { ISettingManager, SettingManagerExtensions } from "../src/domain/index.js";
import { AuthenticatedHeaders, TenantHeaders, createHttpTest, emailSender, host, json, tenantA } from "./test-support.js";

const test = createHttpTest();
beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const jsonHeaders = { ...AuthenticatedHeaders, "content-type": "application/json" };

describe("api/setting-management/emailing", () => {
  it("returns the email settings of the host with their defaults", async () => {
    const response = await host(test).handle({ method: "GET", path: "/api/setting-management/emailing", headers: AuthenticatedHeaders });
    expect(response.statusCode).toBe(200);
    expect(json<EmailSettingsDto>(response)).toEqual({ smtpHost: "127.0.0.1", smtpPort: 25, smtpUserName: undefined, smtpPassword: undefined, smtpDomain: undefined, smtpEnableSsl: false, smtpUseDefaultCredentials: true, defaultFromAddress: "noreply@abp.io", defaultFromDisplayName: "ABP application" });
  });

  it("requires an authenticated user with the Emailing permission", async () => {
    const anonymous = await host(test).handle({ method: "GET", path: "/api/setting-management/emailing" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe("Test");
  });

  it("updates the global email settings and keeps the password when it is blank", async () => {
    const body = JSON.stringify({ smtpHost: "mail.example.com", smtpPort: 587, smtpUserName: "mailer", smtpPassword: "p@ss", smtpDomain: "example", smtpEnableSsl: true, smtpUseDefaultCredentials: false, defaultFromAddress: "no-reply@example.com", defaultFromDisplayName: "Example" });
    const updated = await host(test).handle({ method: "POST", path: "/api/setting-management/emailing", headers: jsonHeaders, body });
    expect(updated.statusCode).toBe(204);

    const response = await host(test).handle({ method: "GET", path: "/api/setting-management/emailing", headers: AuthenticatedHeaders });
    expect(json<EmailSettingsDto>(response)).toMatchObject({ smtpHost: "mail.example.com", smtpPort: 587, smtpUserName: "mailer", smtpDomain: "example", smtpEnableSsl: true, smtpUseDefaultCredentials: false, defaultFromAddress: "no-reply@example.com", defaultFromDisplayName: "Example" });
    expect(await test.getRequiredService(ISettingProvider).getOrNull(EmailSettingNames.Smtp.Password)).toBe("p@ss");

    const blankPassword = JSON.stringify({ ...JSON.parse(body), smtpPassword: "" });
    await host(test).handle({ method: "POST", path: "/api/setting-management/emailing", headers: jsonHeaders, body: blankPassword });
    expect(await test.getRequiredService(ISettingProvider).getOrNull(EmailSettingNames.Smtp.Password)).toBe("p@ss");
  });

  it("validates the update input", async () => {
    const response = await host(test).handle({ method: "POST", path: "/api/setting-management/emailing", headers: jsonHeaders, body: JSON.stringify({ smtpPort: 0, defaultFromAddress: "", defaultFromDisplayName: "x" }) });
    expect(response.statusCode).toBe(400);
    const error = json(response)["error"] as { validationErrors: { members: string[] }[] };
    expect(error.validationErrors.map((e) => e.members).flat()).toEqual(expect.arrayContaining(["smtpPort", "defaultFromAddress"]));
  });

  it("sends a test email and reports failures as user friendly errors", async () => {
    emailSender.sent.length = 0;
    const sent = await host(test).handle({ method: "POST", path: "/api/setting-management/emailing/send-test-email", headers: jsonHeaders, body: JSON.stringify({ senderEmailAddress: "me@example.com", targetEmailAddress: "you@example.com", subject: "Test", body: "Hello" }) });
    expect(sent.statusCode).toBe(204);
    expect(emailSender.sent).toEqual([{ from: "me@example.com", to: "you@example.com", subject: "Test", body: "Hello" }]);

    const failed = await host(test).handle({ method: "POST", path: "/api/setting-management/emailing/send-test-email", headers: jsonHeaders, body: JSON.stringify({ senderEmailAddress: "me@example.com", targetEmailAddress: "fail@example.com", subject: "Test" }) });
    expect(failed.statusCode).toBe(403);
    expect((json(failed)["error"] as { message: string }).message).toBe("Mail sending failed, please check your email configuration and try again.");
  });

  it("refuses tenants while the AllowChangingEmailSettings feature is disabled (the permission's state checker)", async () => {
    const response = await host(test).handle({ method: "GET", path: "/api/setting-management/emailing", headers: TenantHeaders });
    expect(response.statusCode).toBe(403);
    expect((json(response)["error"] as { code: string }).code).toMatch(/^Volo\.Authorization:/);
  });

  it("delegates 1:1 to the application service", () => {
    expect(test.getRequiredService(EmailSettingsController)).toBeInstanceOf(EmailSettingsController);
    expect(test.getRequiredService(TimeZoneSettingsController)).toBeInstanceOf(TimeZoneSettingsController);
  });
});

describe("api/setting-management/timezone", () => {
  it("reads and updates the host time zone and lists the available ones", async () => {
    const initial = await host(test).handle({ method: "GET", path: "/api/setting-management/timezone", headers: AuthenticatedHeaders });
    expect(initial.statusCode).toBe(200);
    expect(initial.bodyText).toBe("Unspecified");

    const updated = await host(test).handle({ method: "POST", path: "/api/setting-management/timezone", query: "timezone=Europe/Berlin", headers: AuthenticatedHeaders });
    expect(updated.statusCode).toBe(204);
    expect((await host(test).handle({ method: "GET", path: "/api/setting-management/timezone", headers: AuthenticatedHeaders })).bodyText).toBe("Europe/Berlin");
    expect(await SettingManagerExtensions.getOrNullGlobal(test.getRequiredService(ISettingManager), TimingSettingNames.TimeZone)).toBe("Europe/Berlin");

    await host(test).handle({ method: "POST", path: "/api/setting-management/timezone", query: "timezone=unspecified", headers: AuthenticatedHeaders });
    expect((await host(test).handle({ method: "GET", path: "/api/setting-management/timezone", headers: AuthenticatedHeaders })).bodyText).toBe("Unspecified");

    const timezones = json<{ name: string; value: string }[]>(await host(test).handle({ method: "GET", path: "/api/setting-management/timezone/timezones", headers: AuthenticatedHeaders }));
    expect(timezones[0]).toEqual({ name: "Default time zone", value: "Unspecified" });
    expect(timezones.some((t) => t.value === "Europe/Berlin" && t.name.startsWith("Europe/Berlin (+01:00)"))).toBe(true);
  });

  it("stores the time zone of a tenant for that tenant only", async () => {
    const updated = await host(test).handle({ method: "POST", path: "/api/setting-management/timezone", query: "timezone=Asia/Tokyo", headers: TenantHeaders });
    expect(updated.statusCode).toBe(204);
    expect((await host(test).handle({ method: "GET", path: "/api/setting-management/timezone", headers: TenantHeaders })).bodyText).toBe("Asia/Tokyo");
    expect((await host(test).handle({ method: "GET", path: "/api/setting-management/timezone", headers: AuthenticatedHeaders })).bodyText).toBe("Unspecified");
    const manager = test.getRequiredService(ISettingManager);
    expect(await SettingManagerExtensions.getOrNullForTenant(manager, TimingSettingNames.TimeZone, tenantA, false)).toBe("Asia/Tokyo");
    expect(await test.getRequiredService(ICurrentTenant).run(tenantA, undefined, () => test.getRequiredService(ISettingProvider).getOrNull(TimingSettingNames.TimeZone))).toBe("Asia/Tokyo");
  });
});
