import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Guid, NullLoggerFactory } from "@abp/core";
import { AbpHttpHost } from "@abp/aws-lambda";
import { IDataSeeder } from "@abp/data";
import type { PagedResultDto } from "@abp/ddd-application";
import { IPermissionManager } from "@abp/permission-management/domain";
import { createAbpIntegratedTest } from "@abp/test-base";
import type { IdentityRoleDto, IdentityUserDto } from "../src/application-contracts/index.js";
import { IdentityRole, IdentityRoleManager, IdentityUser, IdentityUserManager } from "../src/domain/index.js";
import { IdentityTestModule } from "./identity-test-module.js";

const test = createAbpIntegratedTest(IdentityTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });
let host: AbpHttpHost;

beforeAll(async () => {
  await test.initialize();
  await test.getRequiredService(IDataSeeder).seed();
  const userManager = test.getRequiredService(IdentityUserManager);
  (await test.getRequiredService(IdentityRoleManager).create(new IdentityRole(Guid.newGuid(), "viewer"))).checkErrors();
  const bob = new IdentityUser(Guid.newGuid(), "bob", "bob@abp.io");
  (await userManager.create(bob, "1q2w3E*")).checkErrors();
  (await userManager.addToRole(bob, "viewer")).checkErrors();
  await test.getRequiredService(IPermissionManager).set("AbpIdentity.Users", "R", "viewer", true);
  await test.getRequiredService(IPermissionManager).set("AbpIdentity.UserLookup", "C", "lookup-client", true);
  host = new AbpHttpHost(test.application);
});
afterAll(() => test.dispose());

type Request = { method: "GET" | "POST" | "PUT" | "DELETE"; path: string; query?: string; body?: unknown; user?: string; client?: string };

async function call<T = unknown>(request: Request): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (request.user) headers["x-test-user"] = request.user;
  if (request.client) headers["x-test-client"] = request.client;
  const response = await host.handle({ method: request.method, path: request.path, query: request.query, headers, body: request.body === undefined ? undefined : JSON.stringify(request.body) });
  return { status: response.statusCode, body: response.bodyText ? (JSON.parse(response.bodyText) as T) : (undefined as T) };
}

describe("IdentityUserController (api/identity/users)", () => {
  it("requires authentication and the AbpIdentity.Users.* permissions", async () => {
    expect((await call({ method: "GET", path: "/api/identity/users" })).status).toBe(401);
    expect((await call({ method: "GET", path: "/api/identity/users", user: "bob" })).status).toBe(200);
    expect((await call({ method: "POST", path: "/api/identity/users", user: "bob", body: { userName: "x", email: "x@abp.io", password: "1q2w3E*" } })).status).toBe(403);
    expect((await call({ method: "GET", path: "/api/identity/roles", user: "bob" })).status).toBe(403);
  });

  it("creates, reads, updates, assigns roles to and deletes users as admin", async () => {
    const created = await call<IdentityUserDto>({ method: "POST", path: "/api/identity/users", user: "admin", body: { userName: "alice", email: "alice@abp.io", password: "1q2w3E*", name: "Alice", roleNames: ["viewer"], lockoutEnabled: true, isActive: true } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ userName: "alice", email: "alice@abp.io", name: "Alice", isActive: true });
    expect(created.body).not.toHaveProperty("passwordHash");
    const id = created.body.id;

    expect((await call<IdentityUserDto>({ method: "GET", path: `/api/identity/users/${id}`, user: "admin" })).body.userName).toBe("alice");
    expect((await call<IdentityUserDto>({ method: "GET", path: "/api/identity/users/by-username/alice", user: "admin" })).body.id).toBe(id);
    expect((await call<IdentityUserDto>({ method: "GET", path: "/api/identity/users/by-email/alice@abp.io", user: "admin" })).body.id).toBe(id);
    expect((await call<{ items: IdentityRoleDto[] }>({ method: "GET", path: `/api/identity/users/${id}/roles`, user: "admin" })).body.items.map((r) => r.name)).toEqual(["viewer"]);

    const list = await call<PagedResultDto<IdentityUserDto>>({ method: "GET", path: "/api/identity/users", query: "filter=ali&maxResultCount=10", user: "admin" });
    expect(list.body.totalCount).toBe(1);
    expect(list.body.items[0]!.userName).toBe("alice");

    const updated = await call<IdentityUserDto>({ method: "PUT", path: `/api/identity/users/${id}`, user: "admin", body: { userName: "alice", email: "alice@abp.io", name: "Alicia", surname: "Doe", roleNames: [], lockoutEnabled: true, isActive: true, concurrencyStamp: created.body.concurrencyStamp } });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Alicia", surname: "Doe" });

    await call({ method: "PUT", path: `/api/identity/users/${id}/roles`, user: "admin", body: { roleNames: ["viewer", "admin"] } });
    expect((await call<{ items: IdentityRoleDto[] }>({ method: "GET", path: `/api/identity/users/${id}/roles`, user: "admin" })).body.items.map((r) => r.name).sort()).toEqual(["admin", "viewer"]);
    expect((await call<{ items: IdentityRoleDto[] }>({ method: "GET", path: "/api/identity/users/assignable-roles", user: "admin" })).body.items.map((r) => r.name).sort()).toEqual(["admin", "viewer"]);

    expect((await call({ method: "DELETE", path: `/api/identity/users/${id}`, user: "admin" })).status).toBe(204);
    expect((await call({ method: "GET", path: `/api/identity/users/${id}`, user: "admin" })).status).toBe(404);
  });

  it("validates the create input and reports identity errors as business exceptions", async () => {
    expect((await call({ method: "POST", path: "/api/identity/users", user: "admin", body: { userName: "", email: "nope", password: "1q2w3E*" } })).status).toBe(400);
    const duplicate = await call<{ error: { message: string } }>({ method: "POST", path: "/api/identity/users", user: "admin", body: { userName: "bob", email: "bob2@abp.io", password: "1q2w3E*" } });
    expect(duplicate.status).toBe(403);
    expect(duplicate.body.error.message).toBe("Username 'bob' is already taken.");
  });

  it("forbids deleting the current user", async () => {
    const admin = await test.getRequiredService(IdentityUserManager).findByName("admin");
    const response = await call<{ error: { code: string } }>({ method: "DELETE", path: `/api/identity/users/${admin!.id}`, user: "admin" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("Volo.Abp.Identity:010001");
  });
});

describe("IdentityRoleController (api/identity/roles)", () => {
  it("creates, lists, updates and deletes roles, protecting static ones", async () => {
    const created = await call<IdentityRoleDto>({ method: "POST", path: "/api/identity/roles", user: "admin", body: { name: "auditor", isDefault: true, isPublic: false } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: "auditor", isDefault: true, isPublic: false, isStatic: false });

    const all = await call<{ items: IdentityRoleDto[] }>({ method: "GET", path: "/api/identity/roles/all", user: "admin" });
    expect(all.body.items.map((r) => r.name).sort()).toEqual(["admin", "auditor", "viewer"]);
    const filtered = await call<PagedResultDto<IdentityRoleDto>>({ method: "GET", path: "/api/identity/roles", query: "filter=aud", user: "admin" });
    expect(filtered.body.totalCount).toBe(1);

    const updated = await call<IdentityRoleDto>({ method: "PUT", path: `/api/identity/roles/${created.body.id}`, user: "admin", body: { name: "reviewer", isDefault: false, isPublic: true, concurrencyStamp: created.body.concurrencyStamp } });
    expect(updated.body).toMatchObject({ name: "reviewer", isDefault: false, isPublic: true });

    const adminRole = all.body.items.find((r) => r.name === "admin")!;
    const renameStatic = await call<{ error: { code: string } }>({ method: "PUT", path: `/api/identity/roles/${adminRole.id}`, user: "admin", body: { name: "root", isDefault: false, isPublic: true } });
    expect(renameStatic.status).toBe(403);
    expect(renameStatic.body.error.code).toBe("Volo.Abp.Identity:010005");
    expect((await call<{ error: { code: string } }>({ method: "DELETE", path: `/api/identity/roles/${adminRole.id}`, user: "admin" })).body.error.code).toBe("Volo.Abp.Identity:010006");

    expect((await call({ method: "DELETE", path: `/api/identity/roles/${created.body.id}`, user: "admin" })).status).toBe(204);
    expect((await call({ method: "GET", path: `/api/identity/roles/${created.body.id}`, user: "admin" })).status).toBe(404);
  });
});

describe("IdentityUserLookupController (api/identity/users/lookup)", () => {
  it("is granted to clients (AbpIdentity.UserLookup is a client-provider permission) and finds users by id and name, searches and counts", async () => {
    const bob = (await test.getRequiredService(IdentityUserManager).findByName("bob"))!;
    expect((await call({ method: "GET", path: `/api/identity/users/lookup/${bob.id}` })).status).toBe(401);
    expect((await call({ method: "GET", path: `/api/identity/users/lookup/${bob.id}`, user: "admin" })).status).toBe(403);
    const byId = await call<{ id: string; userName: string }>({ method: "GET", path: `/api/identity/users/lookup/${bob.id}`, user: "bob", client: "lookup-client" });
    expect(byId.body).toMatchObject({ id: bob.id, userName: "bob", email: "bob@abp.io" });
    expect(byId.body).not.toHaveProperty("passwordHash");
    expect((await call<{ id: string }>({ method: "GET", path: "/api/identity/users/lookup/by-username/BOB", user: "bob", client: "lookup-client" })).body.id).toBe(bob.id);
    expect((await call({ method: "GET", path: "/api/identity/users/lookup/by-username/nobody", user: "bob", client: "lookup-client" })).status).toBe(204);
    const search = await call<{ items: { userName: string }[] }>({ method: "GET", path: "/api/identity/users/lookup/search", query: "filter=bo", user: "bob", client: "lookup-client" });
    expect(search.body.items.map((u) => u.userName)).toEqual(["bob"]);
    expect((await call<number>({ method: "GET", path: "/api/identity/users/lookup/count", query: "filter=bo", user: "bob", client: "lookup-client" })).body).toBe(1);
  });
});

describe("IdentityUserIntegrationController (integration-api/identity/users)", () => {
  it("returns role names and user data", async () => {
    const bob = (await test.getRequiredService(IdentityUserManager).findByName("bob"))!;
    expect((await call<string[]>({ method: "GET", path: `/integration-api/identity/users/${bob.id}/role-names`, user: "admin" })).body).toEqual(["viewer"]);
    const byIds = await call<{ items: { id: string }[] }>({ method: "GET", path: "/integration-api/identity/users/search/by-ids", query: `ids=${bob.id}`, user: "admin" });
    expect(byIds.body.items.map((u) => u.id)).toEqual([bob.id]);
    const roles = await call<{ items: { name: string }[] }>({ method: "GET", path: "/integration-api/identity/users/search/roles/by-names", query: "names=viewer&names=admin", user: "admin" });
    expect(roles.body.items.map((r) => r.name).sort()).toEqual(["admin", "viewer"]);
  });
});
