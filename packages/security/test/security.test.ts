import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Transient, delay } from "@abp/core";
import {
  AbpClaimTypes,
  AbpClaimsPrincipalContributor,
  AbpClaimsPrincipalFactory,
  AbpClaimsPrincipalFactoryOptions,
  AbpSecurityModule,
  AbpStringEncryptionOptions,
  Claim,
  ClaimsIdentity,
  ClaimsPrincipal,
  IAbpClaimsPrincipalFactory,
  ICurrentClient,
  ICurrentPrincipalAccessor,
  ICurrentUser,
  IStringEncryptionService,
  StringEncryptionService,
  addOrReplace,
  findClientId,
  findTenantId,
  findUserId,
  getId,
  type AbpClaimsPrincipalContributorContext,
  type IAbpClaimsPrincipalContributor,
} from "../src/index.js";

const userId = "0b7c9d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const tenantId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function userPrincipal(name = "john"): ClaimsPrincipal {
  return new ClaimsPrincipal(
    new ClaimsIdentity(
      [
        new Claim(AbpClaimTypes.userId, userId),
        new Claim(AbpClaimTypes.userName, name),
        new Claim(AbpClaimTypes.tenantId, tenantId),
        new Claim(AbpClaimTypes.role, "admin"),
        new Claim(AbpClaimTypes.role, "editor"),
        new Claim(AbpClaimTypes.role, "admin"),
        new Claim(AbpClaimTypes.emailVerified, "True"),
        new Claim(AbpClaimTypes.clientId, "web-client"),
      ],
      "Bearer",
    ),
  );
}

@Transient()
@AbpClaimsPrincipalContributor()
class TestContributor implements IAbpClaimsPrincipalContributor {
  async contribute(context: AbpClaimsPrincipalContributorContext): Promise<void> {
    context.claimsPrincipal.identity?.addClaim(new Claim("contributed", "yes"));
  }
}

@DependsOn(AbpSecurityModule)
class TestModule extends AbpModule {}

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { StringEncryption: { DefaultPassPhrase: "configured-pass" } } } });
  await app.initialize();
  return app;
}

describe("claims", () => {
  it("principal helpers find typed claims and respect authentication", () => {
    const principal = userPrincipal();
    expect(principal.isAuthenticated).toBe(true);
    expect(new ClaimsPrincipal(new ClaimsIdentity()).isAuthenticated).toBe(false);
    expect(findUserId(principal)).toBe(userId);
    expect(findTenantId(principal)).toBe(tenantId);
    expect(findClientId(principal)).toBe("web-client");
    expect(findUserId(new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, "not-a-guid")])))).toBeUndefined();
    expect(principal.findAll(AbpClaimTypes.role).map((c) => c.value)).toEqual(["admin", "editor", "admin"]);
    expect(principal.isInRole("editor")).toBe(true);
    expect(principal.identity?.name).toBe("john");
  });

  it("addOrReplace replaces all claims of the type", () => {
    const identity = userPrincipal().identity!;
    addOrReplace(identity, new Claim(AbpClaimTypes.role, "viewer"));
    expect(identity.findAll(AbpClaimTypes.role).map((c) => c.value)).toEqual(["viewer"]);
  });
});

describe("current principal accessor / current user", () => {
  it("exposes the ambient principal through ICurrentUser and ICurrentClient", async () => {
    const app = await createApp();
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const currentUser = app.serviceProvider.getRequired(ICurrentUser);
    const currentClient = app.serviceProvider.getRequired(ICurrentClient);

    expect(currentUser.isAuthenticated).toBe(false);
    expect(currentUser.roles).toEqual([]);

    const scope = accessor.change(userPrincipal());
    try {
      expect(currentUser.isAuthenticated).toBe(true);
      expect(getId(currentUser)).toBe(userId);
      expect(currentUser.userName).toBe("john");
      expect(currentUser.tenantId).toBe(tenantId);
      expect(currentUser.roles).toEqual(["admin", "editor"]);
      expect(currentUser.isInRole("admin")).toBe(true);
      expect(currentUser.emailVerified).toBe(true);
      expect(currentClient.id).toBe("web-client");
      expect(currentClient.isAuthenticated).toBe(true);
    } finally {
      scope[Symbol.dispose]();
    }
    expect(currentUser.isAuthenticated).toBe(false);
    await app.shutdown();
  });

  it("isolates principals across concurrent async flows with run and nested change", async () => {
    const app = await createApp();
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const currentUser = app.serviceProvider.getRequired(ICurrentUser);

    const results = await Promise.all(
      ["alice", "bob", "carol"].map((name, i) =>
        accessor.run(userPrincipal(name), async () => {
          await delay(10 - i * 3);
          const outer = currentUser.userName;
          const inner = accessor.run(new Claim(AbpClaimTypes.userName, `${name}-inner`), () => currentUser.userName);
          await delay(2);
          return [outer, inner, currentUser.userName];
        }),
      ),
    );
    expect(results).toEqual([
      ["alice", "alice-inner", "alice"],
      ["bob", "bob-inner", "bob"],
      ["carol", "carol-inner", "carol"],
    ]);
    expect(currentUser.userName).toBeUndefined();
    await app.shutdown();
  });
});

describe("string encryption", () => {
  it("round-trips and honours pass phrase, salt and configuration", async () => {
    const app = await createApp();
    const service = app.serviceProvider.getRequired(IStringEncryptionService);
    const cipher = service.encrypt("hello ABP ünïcode");
    expect(cipher).not.toBe("hello ABP ünïcode");
    expect(service.decrypt(cipher)).toBe("hello ABP ünïcode");
    expect(service.decrypt(service.encrypt("x", "other-pass", Buffer.from("salt1234")), "other-pass", Buffer.from("salt1234"))).toBe("x");
    expect(service.encrypt(undefined)).toBeUndefined();
    expect(service.decrypt("")).toBeUndefined();
    expect(app.serviceProvider.getOptions(AbpStringEncryptionOptions).defaultPassPhrase).toBe("configured-pass");
    await app.shutdown();
  });

  it("emits base64 AES blocks and works standalone with default options", () => {
    const service = new StringEncryptionService({ value: new AbpStringEncryptionOptions() });
    const cipher = service.encrypt("abp")!;
    expect(Buffer.from(cipher, "base64").length).toBe(16);
    expect(service.decrypt(cipher)).toBe("abp");
  });
});

describe("claims principal factory", () => {
  it("runs auto-registered contributors and reuses an existing principal", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getOptions(AbpClaimsPrincipalFactoryOptions).contributors.contains(TestContributor)).toBe(true);
    const factory = app.serviceProvider.getRequired(IAbpClaimsPrincipalFactory);
    const created = await factory.create();
    expect(created.identity?.authenticationType).toBe(AbpClaimsPrincipalFactory.authenticationType);
    expect(created.findFirst("contributed")?.value).toBe("yes");

    const existing = userPrincipal();
    expect(await factory.create(existing)).toBe(existing);
    expect(existing.findFirst("contributed")?.value).toBe("yes");

    const dynamic = await factory.createDynamic(userPrincipal());
    expect(dynamic.findFirst("contributed")).toBeUndefined();
    await app.shutdown();
  });
});
