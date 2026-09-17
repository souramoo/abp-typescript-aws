import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Guid, NullLoggerFactory } from "@abp/core";
import { AbpHttpHost } from "@abp/aws-lambda";
import { IDataSeeder } from "@abp/data";
import { IdentityUser, IdentityUserManager } from "@abp/identity/domain";
import { createAbpIntegratedTest } from "@abp/test-base";
import type { ProfileDto } from "../src/application-contracts/index.js";
import { AccountTestModule } from "./account-test-module.js";

const test = createAbpIntegratedTest(AccountTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });
let host: AbpHttpHost;

beforeAll(async () => {
  await test.initialize();
  await test.getRequiredService(IDataSeeder).seed();
  const userManager = test.getRequiredService(IdentityUserManager);
  const carol = new IdentityUser(Guid.newGuid(), "carol", "carol@abp.io");
  (await userManager.create(carol, "1q2w3E*")).checkErrors();
  host = new AbpHttpHost(test.application);
});
afterAll(() => test.dispose());

async function call<T = unknown>(method: "GET" | "PUT" | "POST", path: string, body?: unknown, user?: string): Promise<{ status: number; body: T }> {
  const response = await host.handle({ method, path, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.statusCode, body: response.bodyText ? (JSON.parse(response.bodyText) as T) : (undefined as T) };
}

describe("ProfileController (api/account/my-profile)", () => {
  it("requires an authenticated user", async () => {
    expect((await call("GET", "/api/account/my-profile")).status).toBe(401);
    expect((await call("PUT", "/api/account/my-profile", { userName: "x" })).status).toBe(401);
    expect((await call("POST", "/api/account/my-profile/change-password", { currentPassword: "a", newPassword: "b" })).status).toBe(401);
  });

  it("returns and updates the current user's profile", async () => {
    const profile = await call<ProfileDto>("GET", "/api/account/my-profile", undefined, "carol");
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ userName: "carol", email: "carol@abp.io", isExternal: false, hasPassword: true });
    expect(profile.body).not.toHaveProperty("passwordHash");

    const updated = await call<ProfileDto>("PUT", "/api/account/my-profile", { userName: "carol", email: "carol@abp.io", name: " Carol ", surname: "Danvers", phoneNumber: "+1555", concurrencyStamp: profile.body.concurrencyStamp }, "carol");
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Carol", surname: "Danvers", phoneNumber: "+1555" });

    const renamed = await call<ProfileDto>("PUT", "/api/account/my-profile", { userName: "carol2", email: "carol2@abp.io", name: "Carol", surname: "Danvers", concurrencyStamp: updated.body.concurrencyStamp }, "carol");
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ userName: "carol2", email: "carol2@abp.io" });
    expect((await test.getRequiredService(IdentityUserManager).findByName("carol2"))?.email).toBe("carol2@abp.io");
    (await test.getRequiredService(IdentityUserManager).setUserName((await test.getRequiredService(IdentityUserManager).findByName("carol2"))!, "carol")).checkErrors();
  });

  it("changes the password", async () => {
    const wrong = await call<{ error: { message: string } }>("POST", "/api/account/my-profile/change-password", { currentPassword: "nope", newPassword: "2w3e4R*" }, "carol");
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toBe("Incorrect password.");

    const same = await call<{ error: { validationErrors: { members: string[] }[] } }>("POST", "/api/account/my-profile/change-password", { currentPassword: "1q2w3E*", newPassword: "1q2w3E*" }, "carol");
    expect(same.status).toBe(400);
    expect(same.body.error.validationErrors[0]!.members).toEqual(["currentPassword", "newPassword"]);

    expect((await call("POST", "/api/account/my-profile/change-password", { currentPassword: "1q2w3E*", newPassword: "2w3e4R*" }, "carol")).status).toBe(204);
    const userManager = test.getRequiredService(IdentityUserManager);
    expect(await userManager.checkPassword((await userManager.findByName("carol"))!, "2w3e4R*")).toBe(true);
  });
});
