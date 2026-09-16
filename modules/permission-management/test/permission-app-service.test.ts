import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, NullLoggerFactory, Transient, type Guid, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuthenticationOptions, AbpHttpHost, AuthenticateResult, type AbpHttpContext, type IAuthenticationHandler } from "@abp/aws-lambda";
import { IDataSeeder } from "@abp/data";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal } from "@abp/security";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpPermissionManagementApplicationModule } from "../src/application/index.js";
import type { GetPermissionListResultDto } from "../src/application-contracts/index.js";
import { IUserRoleFinder } from "../src/domain-shared/index.js";
import { AbpPermissionManagementDomainIdentityModule } from "../src/domain/index.js";
import { AbpPermissionManagementHttpApiModule } from "../src/http-api/index.js";
import { AbpPermissionManagementMemoryDbModule } from "../src/memory-db/index.js";
import { TestPermissions, userRoleFinder } from "./test-module.js";

const adminId = "44444444-4444-4444-8444-444444444444";
const carolId = "55555555-5555-4555-8555-555555555555";
const bobId = "66666666-6666-4666-8666-666666666666";

const users: Record<string, { id: Guid; roles: string[] }> = {
  admin: { id: adminId, roles: ["admin"] },
  carol: { id: carolId, roles: ["editor"] },
  bob: { id: bobId, roles: [] },
};

@Transient()
class HeaderAuthenticationHandler implements IAuthenticationHandler {
  async authenticate(context: AbpHttpContext): Promise<AuthenticateResult> {
    const userName = context.request.headers.get("x-test-user");
    const user = userName ? users[userName] : undefined;
    if (!user) return AuthenticateResult.noResult();
    const claims = [new Claim(AbpClaimTypes.userId, user.id), new Claim(AbpClaimTypes.userName, userName!), ...user.roles.map((r) => new Claim(AbpClaimTypes.role, r))];
    return AuthenticateResult.success(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")));
  }
}

@DependsOn(AbpPermissionManagementHttpApiModule, AbpPermissionManagementApplicationModule, AbpPermissionManagementMemoryDbModule, AbpPermissionManagementDomainIdentityModule)
class PermissionManagementHttpTestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addSingleton(IUserRoleFinder, { useValue: userRoleFinder });
    this.configure(AbpAuthenticationOptions, (options) => options.addScheme("Test", HeaderAuthenticationHandler));
  }
}

const test = createAbpIntegratedTest(PermissionManagementHttpTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });
let host: AbpHttpHost;

beforeAll(async () => {
  await test.initialize();
  for (const [, user] of Object.entries(users)) userRoleFinder.roles.set(user.id, user.roles);
  await test.getRequiredService(IDataSeeder).seed();
  host = new AbpHttpHost(test.application);
});
afterAll(() => test.dispose());

const permissionsPath = "/api/permission-management/permissions";

function get(query: string, user?: string) {
  return host.handle({ method: "GET", path: permissionsPath, query, headers: user ? { "x-test-user": user } : {} });
}

function put(query: string, permissions: { name: string; isGranted: boolean }[], user?: string) {
  return host.handle({ method: "PUT", path: permissionsPath, query, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: JSON.stringify({ permissions }) });
}

function body(response: { bodyText: string }): GetPermissionListResultDto {
  return JSON.parse(response.bodyText) as GetPermissionListResultDto;
}

function permission(result: GetPermissionListResultDto, name: string) {
  return result.groups.flatMap((g) => g.permissions).find((p) => p.name === name);
}

describe("PermissionsController", () => {
  it("requires an authenticated user with the provider policy", async () => {
    expect((await get("providerName=R&providerKey=editor")).statusCode).toBe(401);
    expect((await get("providerName=R&providerKey=editor", "bob")).statusCode).toBe(403);
    expect((await get("providerName=R", "admin")).statusCode).toBe(400);
  });

  it("lists the permission groups with grant info and updates grants", async () => {
    const before = body(await get("providerName=R&providerKey=editor", "admin"));
    expect(before.entityDisplayName).toBe("editor");
    expect(before.groups.map((g) => g.name)).toEqual([TestPermissions.GroupName]);
    expect(before.groups[0]).toMatchObject({ displayName: "Permissions", displayNameKey: "Permissions", displayNameResource: "AbpPermissionManagement" });
    expect(permission(before, TestPermissions.Users)).toMatchObject({ isGranted: false, grantedProviders: [], isEditable: true, displayName: "Permissions" });
    expect(permission(before, TestPermissions.Users)?.parentName).toBeUndefined();
    expect(permission(before, TestPermissions.UsersCreate)).toMatchObject({ parentName: TestPermissions.Users });
    expect(permission(before, TestPermissions.RoleOnly)).toMatchObject({ allowedProviders: ["R"] });
    expect(permission(before, TestPermissions.Disabled)).toBeUndefined();

    const update = await put("providerName=R&providerKey=editor", [{ name: TestPermissions.Users, isGranted: true }, { name: TestPermissions.ManageRolePermissions, isGranted: true }], "admin");
    expect([200, 204]).toContain(update.statusCode);

    const after = body(await get("providerName=R&providerKey=editor", "admin"));
    expect(permission(after, TestPermissions.Users)).toMatchObject({ isGranted: true, grantedProviders: [{ providerName: "R", providerKey: "editor" }] });

    const forUser = body(await get(`providerName=U&providerKey=${carolId}`, "admin"));
    expect(permission(forUser, TestPermissions.Users)).toMatchObject({ isGranted: true, grantedProviders: [{ providerName: "R", providerKey: "editor" }] });
    expect(permission(forUser, TestPermissions.RoleOnly)).toBeUndefined();

    const byGroup = await host.handle({ method: "GET", path: `${permissionsPath}/by-group`, query: `groupName=Other&providerName=R&providerKey=editor`, headers: { "x-test-user": "admin" } });
    expect(body(byGroup).groups).toEqual([]);
  });

  it("lets non-admin users edit only the permissions they hold", async () => {
    const carolResponse = await get("providerName=R&providerKey=editor", "carol");
    expect(carolResponse.statusCode, carolResponse.bodyText).toBe(200);
    const asCarol = body(carolResponse);
    expect(permission(asCarol, TestPermissions.Users)).toMatchObject({ isEditable: true });
    expect(permission(asCarol, TestPermissions.UsersCreate)).toMatchObject({ isEditable: false });

    const update = await put("providerName=R&providerKey=editor", [{ name: TestPermissions.UsersCreate, isGranted: true }, { name: TestPermissions.Users, isGranted: false }], "carol");
    expect([200, 204]).toContain(update.statusCode);

    const after = body(await get("providerName=R&providerKey=editor", "admin"));
    expect(permission(after, TestPermissions.UsersCreate)).toMatchObject({ isGranted: false });
    expect(permission(after, TestPermissions.Users)).toMatchObject({ isGranted: false });
  });

  it("rejects invalid bodies", async () => {
    const response = await host.handle({ method: "PUT", path: permissionsPath, query: "providerName=R&providerKey=editor", headers: { "content-type": "application/json", "x-test-user": "admin" }, body: JSON.stringify({ permissions: [{ name: "", isGranted: "yes" }] }) });
    expect(response.statusCode).toBe(400);
  });
});

describe("PermissionIntegrationController", () => {
  it("checks permissions of users in batch", async () => {
    const response = await host.handle({
      method: "POST",
      path: "/integration-api/permission-management/permissions/is-granted",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ userId: adminId, permissionNames: [TestPermissions.Users, TestPermissions.Disabled] }]),
    });
    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.bodyText) as { items: { userId: Guid; permissions: Record<string, boolean> }[] };
    expect(result.items).toEqual([{ userId: adminId, permissions: { [TestPermissions.Users]: true, [TestPermissions.Disabled]: false } }]);
  });
});
