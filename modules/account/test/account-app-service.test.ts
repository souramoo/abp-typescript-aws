import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NullLoggerFactory } from "@abp/core";
import { AbpHttpHost } from "@abp/aws-lambda";
import { IDataSeeder } from "@abp/data";
import { IdentityUserManager, SignInResult } from "@abp/identity/domain";
import { createAbpIntegratedTest } from "@abp/test-base";
import type { IdentityUserDto } from "@abp/identity/application-contracts";
import { AccountSettingNames } from "../src/application-contracts/index.js";
import { AccountEmailTemplates } from "../src/application/index.js";
import { AccountTestModule, emailSender, testRootUrl } from "./account-test-module.js";

const test = createAbpIntegratedTest(AccountTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });
let host: AbpHttpHost;

beforeAll(async () => {
  await test.initialize();
  await test.getRequiredService(IDataSeeder).seed();
  host = new AbpHttpHost(test.application);
});
afterAll(() => test.dispose());

type Response<T> = { status: number; body: T };

async function post<T = unknown>(path: string, body: unknown, user?: string): Promise<Response<T>> {
  const response = await host.handle({ method: "POST", path, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: JSON.stringify(body) });
  return { status: response.statusCode, body: response.bodyText ? (JSON.parse(response.bodyText) as T) : (undefined as T) };
}

describe("AccountController (api/account)", () => {
  it("registers a user that can sign in with the given password", async () => {
    const response = await post<IdentityUserDto>("/api/account/register", { userName: "newbie", emailAddress: "newbie@abp.io", password: "1q2w3E*", appName: "MVC" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userName: "newbie", email: "newbie@abp.io", isActive: true });
    expect(response.body).not.toHaveProperty("passwordHash");

    const userManager = test.getRequiredService(IdentityUserManager);
    const user = (await userManager.findByName("newbie"))!;
    expect(await userManager.checkPasswordSignIn(user, "1q2w3E*", true)).toBe(SignInResult.Success);
  });

  it("validates the registration input and reports duplicates", async () => {
    expect((await post("/api/account/register", { userName: "", emailAddress: "not-an-email", password: "", appName: "MVC" })).status).toBe(400);
    const duplicate = await post<{ error: { message: string } }>("/api/account/register", { userName: "admin", emailAddress: "someone@abp.io", password: "1q2w3E*", appName: "MVC" });
    expect(duplicate.status).toBe(403);
    expect(duplicate.body.error.message).toBe("Username 'admin' is already taken.");
  });

  it("sends a password reset link that verifies and resets the password", async () => {
    const before = emailSender.sent.length;
    expect((await post("/api/account/send-password-reset-code", { email: "admin@abp.io", appName: "MVC", returnUrl: "/dashboard" })).status).toBe(204);
    expect(emailSender.sent).toHaveLength(before + 1);
    const mail = emailSender.last();
    expect(mail.to).toBe("admin@abp.io");
    expect(mail.subject).toBe("Password reset");
    const link = /href="([^"]+)"/.exec(mail.body ?? "")?.[1];
    expect(link).toBeDefined();
    const url = new URL(link!.replace(/&amp;/g, "&"));
    expect(url.origin + url.pathname).toBe(`${testRootUrl}/Account/ResetPassword`);
    expect(url.searchParams.get("returnUrl")).toBe("/dashboard");
    const userId = url.searchParams.get("userId")!;
    const resetToken = url.searchParams.get("resetToken")!;
    expect(userId).toBe((await test.getRequiredService(IdentityUserManager).findByName("admin"))!.id);
    expect(mail.body).toContain("Reset my password");

    expect((await post<boolean>("/api/account/verify-password-reset-token", { userId, resetToken })).body).toBe(true);
    expect((await post<boolean>("/api/account/verify-password-reset-token", { userId, resetToken: "bogus" })).body).toBe(false);

    const wrong = await post<{ error: { message: string } }>("/api/account/reset-password", { userId, resetToken: "bogus", password: "2w3e4R*" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toBe("Invalid token.");

    expect((await post("/api/account/reset-password", { userId, resetToken, password: "2w3e4R*" })).status).toBe(204);
    const userManager = test.getRequiredService(IdentityUserManager);
    const admin = (await userManager.findByName("admin"))!;
    expect(await userManager.checkPassword(admin, "2w3e4R*")).toBe(true);
    expect((await post<boolean>("/api/account/verify-password-reset-token", { userId, resetToken })).body).toBe(false);
  });

  it("rejects password reset requests for unknown e-mail addresses", async () => {
    const response = await post<{ error: { message: string } }>("/api/account/send-password-reset-code", { email: "nobody@abp.io", appName: "MVC" });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Can not find the given email address: nobody@abp.io");
  });

  it("refuses registration when self-registration is disabled", async () => {
    const disabled = createAbpIntegratedTest(AccountTestModule, {
      setAbpApplicationCreationOptions: (options) => {
        options.loggerFactory = NullLoggerFactory.instance;
        options.configuration = { skipDefaults: true, values: { Settings: { [AccountSettingNames.IsSelfRegistrationEnabled]: "false" } } };
      },
    });
    await disabled.initialize();
    try {
      const response = await new AbpHttpHost(disabled.application).handle({ method: "POST", path: "/api/account/register", headers: { "content-type": "application/json" }, body: JSON.stringify({ userName: "late", emailAddress: "late@abp.io", password: "1q2w3E*", appName: "MVC" }) });
      expect(response.statusCode).toBe(403);
      expect((JSON.parse(response.bodyText) as { error: { message: string } }).error.message).toContain("Self-registration is disabled");
    } finally {
      await disabled.dispose();
    }
  });

  it("registers the password reset e-mail template", () => {
    expect(AccountEmailTemplates.PasswordResetLink).toBe("Abp.Account.PasswordResetLink");
  });
});
