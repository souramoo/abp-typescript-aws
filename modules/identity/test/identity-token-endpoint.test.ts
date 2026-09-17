import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Guid, NullLoggerFactory } from "@abp/core";
import { AbpHttpHost } from "@abp/aws-lambda";
import { IDataSeeder } from "@abp/data";
import { createAbpIntegratedTest } from "@abp/test-base";
import { IdentitySecurityLogActionConsts } from "../src/domain-shared/index.js";
import { IIdentitySecurityLogRepository, IIdentitySessionRepository, IdentityUser, IdentityUserManager } from "../src/domain/index.js";
import { IdentityTestModule } from "./identity-test-module.js";

const test = createAbpIntegratedTest(IdentityTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });
let host: AbpHttpHost;

beforeAll(async () => {
  await test.initialize();
  await test.getRequiredService(IDataSeeder).seed();
  const userManager = test.getRequiredService(IdentityUserManager);
  const inactive = new IdentityUser(Guid.newGuid(), "sleeper", "sleeper@abp.io");
  inactive.setIsActive(false);
  (await userManager.create(inactive, "1q2w3E*")).checkErrors();
  host = new AbpHttpHost(test.application);
});
afterAll(() => test.dispose());

function token(values: Record<string, string>) {
  return host.handle({ method: "POST", path: "/connect/token", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", ...values }).toString() });
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function json(response: { bodyText: string }): Record<string, unknown> {
  return JSON.parse(response.bodyText) as Record<string, unknown>;
}

describe("POST /connect/token (password grant) with IdentityResourceOwnerPasswordValidator", () => {
  it("issues an access token with the identity claims, records a session and a security log", async () => {
    const response = await token({ username: "admin", password: "1q2w3E*", scope: "offline_access" });
    expect(response.statusCode).toBe(200);
    const body = json(response) as { access_token: string; refresh_token: string };
    const payload = decodeJwt(body.access_token);
    const admin = (await test.getRequiredService(IdentityUserManager).findByName("admin"))!;
    expect(payload).toMatchObject({ sub: admin.id, preferred_username: "admin", email: "admin@abp.io", role: "admin" });
    expect(typeof payload["session_id"]).toBe("string");
    expect((await test.getRequiredService(IIdentitySessionRepository).findBySessionId(payload["session_id"] as string))?.userId).toBe(admin.id);

    const me = await host.handle({ method: "GET", path: "/api/identity/users/by-username/admin", headers: { authorization: `Bearer ${body.access_token}` } });
    expect(me.statusCode).toBe(200);

    const logs = await test.getRequiredService(IIdentitySecurityLogRepository).getList({ userName: "admin" });
    expect(logs.map((l) => l.action)).toContain(IdentitySecurityLogActionConsts.loginSucceeded);
    expect((await test.getRequiredService(IdentityUserManager).findByName("admin"))!.lastSignInTime).toBeInstanceOf(Date);
  });

  it("also accepts the e-mail address as user name", async () => {
    expect((await token({ username: "admin@abp.io", password: "1q2w3E*" })).statusCode).toBe(200);
  });

  it("rejects a wrong password with invalid_grant and counts the failure", async () => {
    const response = await token({ username: "admin", password: "nope" });
    expect(response.statusCode).toBe(400);
    expect(json(response)).toEqual({ error: "invalid_grant", error_description: "Invalid username or password!" });
    expect(json(await token({ username: "ghost", password: "nope" }))["error"]).toBe("invalid_grant");
    expect((await test.getRequiredService(IdentityUserManager).findByName("admin"))!.accessFailedCount).toBe(1);
  });

  it("reports locked out and inactive accounts", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const locky = new IdentityUser(Guid.newGuid(), "locky", "locky@abp.io");
    (await userManager.create(locky, "1q2w3E*")).checkErrors();
    for (let i = 0; i < 5; i++) await token({ username: "locky", password: "wrong" });
    const locked = await token({ username: "locky", password: "1q2w3E*" });
    expect(locked.statusCode).toBe(400);
    expect(json(locked)["error"]).toBe("account_locked");

    const inactive = await token({ username: "sleeper", password: "1q2w3E*" });
    expect(json(inactive)["error"]).toBe("account_inactive");
  });
});
