import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NullLoggerFactory, type AbpApplication, type IServiceProvider } from "@abp/core";
import { AbpHttpHost } from "@abp/aws-lambda";
import { IAuditLogRepository } from "@abp/audit-logging/domain";
import { IDataSeeder } from "@abp/data";
import type { PagedResultDto } from "@abp/ddd-application";
import { IdentityUser, IdentityUserManager } from "@abp/identity/domain";
import type { IdentityUserDto } from "@abp/identity/application-contracts";
import { ITenantRepository } from "@abp/tenant-management/domain";
import type { OpenApiDocument } from "@abp/swashbuckle";
import { IUnitOfWorkManager } from "@abp/uow";
import { createLocalApplication } from "../src/application.js";
import { BookType, TemplateAppPermissions, type BookDto } from "../src/books/index.js";
import { TemplateAppClientId } from "../src/template-app-module.js";

const acmeTenantId = "3a0f1b2c-9d8e-4f7a-b6c5-d4e3f2a1b0c9";

let app: AbpApplication;
let host: AbpHttpHost;

beforeAll(async () => {
  app = await createLocalApplication({ loggerFactory: NullLoggerFactory.instance });
  await app.serviceProvider.getRequired(IDataSeeder).seed();
  const userManager = app.serviceProvider.getRequired(IdentityUserManager);
  const bob = new IdentityUser("6d8c1f3a-2b4e-4c6d-8e0f-1a2b3c4d5e6f", "bob", "bob@abp.io");
  (await userManager.create(bob, "1q2w3E*")).checkErrors();
  host = new AbpHttpHost(app);
});

afterAll(async () => {
  await app.shutdown();
});

type Json = Record<string, unknown>;
type Call = { method: "GET" | "POST" | "PUT" | "DELETE"; path: string; query?: string; body?: unknown; token?: string; headers?: Record<string, string> };

async function call<T = Json>(request: Call): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...request.headers };
  if (request.token) headers["authorization"] = `Bearer ${request.token}`;
  const response = await host.handle({ method: request.method, path: request.path, query: request.query, headers, body: request.body === undefined ? undefined : JSON.stringify(request.body) });
  return { status: response.statusCode, body: response.bodyText ? (JSON.parse(response.bodyText) as T) : (undefined as T), headers: response.headers.toRecord() as Record<string, string> };
}

async function token(username: string, password = "1q2w3E*", headers: Record<string, string> = {}): Promise<string> {
  const response = await host.handle({
    method: "POST",
    path: "/connect/token",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ grant_type: "password", username, password, client_id: TemplateAppClientId, scope: "offline_access" }).toString(),
  });
  expect(response.statusCode, response.bodyText).toBe(200);
  return (JSON.parse(response.bodyText) as { access_token: string }).access_token;
}

function decodeJwt(jwt: string): Json {
  return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as Json;
}

async function inUnitOfWork<T>(fn: (provider: IServiceProvider) => Promise<T>): Promise<T> {
  const scope = app.serviceProvider.createScope();
  try {
    const uow = scope.serviceProvider.getRequired(IUnitOfWorkManager).begin(undefined, true);
    try {
      const result = await fn(scope.serviceProvider);
      await uow.complete();
      return result;
    } finally {
      await uow.dispose();
    }
  } finally {
    await scope.dispose();
  }
}

describe("TemplateAppLocalModule boots the whole application", () => {
  it("serves the application configuration with every ABP section", async () => {
    const { status, body } = await call({ method: "GET", path: "/api/abp/application-configuration" });
    expect(status).toBe(200);
    expect(body).toHaveProperty("localization");
    expect(body).toHaveProperty("auth");
    expect(body).toHaveProperty("setting");
    expect(body).toHaveProperty("features");
    expect(body).toHaveProperty("currentUser");
    expect(body["multiTenancy"]).toEqual({ isEnabled: true, userSharingStrategy: 0 });
    expect(body["currentUser"]).toMatchObject({ isAuthenticated: false });

    const localization = body["localization"] as { languages: { cultureName: string }[]; values: Record<string, Record<string, string>>; defaultResourceName: string };
    expect(localization.languages.map((l) => l.cultureName)).toEqual(expect.arrayContaining(["en", "tr", "de-DE"]));
    expect(localization.defaultResourceName).toBe("TemplateApp");
    expect(localization.values["TemplateApp"]?.["Permission:Books"]).toBe("Book Management");
    expect(localization.values).toHaveProperty("AbpIdentity");
  });

  it("seeds the admin user and role, the sample books and the configured tenant", async () => {
    const admin = await app.serviceProvider.getRequired(IdentityUserManager).findByName("admin");
    expect(admin?.email).toBe("admin@abp.io");
    expect(await app.serviceProvider.getRequired(IdentityUserManager).getRoles(admin!)).toEqual(["admin"]);

    const tenants = await inUnitOfWork((p) => p.getRequired(ITenantRepository).getList());
    expect(tenants.map((t) => [t.id, t.name])).toEqual([[acmeTenantId, "acme"]]);

    const books = await call<PagedResultDto<BookDto>>({ method: "GET", path: "/api/app/books", token: await token("admin") });
    expect(books.status).toBe(200);
    expect(books.body.totalCount).toBe(2);
    expect(books.body.items.map((b) => b.name).sort()).toEqual(["1984", "The Hitchhiker's Guide to the Galaxy"]);
    expect(books.body.items.find((b) => b.name === "1984")).toMatchObject({ type: BookType.Dystopia, price: 19.84 });
  });
});

describe("authentication and the sample API", () => {
  it("issues a JWT for admin through the password grant with the identity claims", async () => {
    const jwt = await token("admin");
    expect(decodeJwt(jwt)).toMatchObject({ preferred_username: "admin", role: "admin", iss: "TemplateApp", aud: "TemplateApp", client_id: TemplateAppClientId });
  });

  it("lists identity users and the granted permissions of the admin role with the token", async () => {
    const jwt = await token("admin");
    const users = await call<PagedResultDto<IdentityUserDto>>({ method: "GET", path: "/api/identity/users", token: jwt });
    expect(users.status).toBe(200);
    expect(users.body.items.map((u) => u.userName)).toEqual(expect.arrayContaining(["admin", "bob"]));

    const permissions = await call<{ entityDisplayName: string; groups: { name: string; permissions: { name: string; isGranted: boolean }[] }[] }>({ method: "GET", path: "/api/permission-management/permissions", query: "providerName=R&providerKey=admin", token: jwt });
    expect(permissions.status).toBe(200);
    const bookPermissions = permissions.body.groups.find((g) => g.name === TemplateAppPermissions.GroupName)?.permissions;
    expect(bookPermissions?.filter((p) => p.isGranted).map((p) => p.name)).toEqual([TemplateAppPermissions.Books.Default, TemplateAppPermissions.Books.Create, TemplateAppPermissions.Books.Edit, TemplateAppPermissions.Books.Delete]);
  });

  it("creates, reads, updates and deletes a book and audits the write requests", async () => {
    const jwt = await token("admin");
    const created = await call<BookDto>({ method: "POST", path: "/api/app/books", token: jwt, body: { name: "Dune", type: BookType.ScienceFiction, publishDate: "1965-08-01", price: 12.5 } });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({ name: "Dune", type: BookType.ScienceFiction, price: 12.5 });
    expect(typeof created.body.creationTime).toBe("string");

    const read = await call<BookDto>({ method: "GET", path: `/api/app/books/${created.body.id}`, token: jwt });
    expect(read.body.name).toBe("Dune");

    const updated = await call<BookDto>({ method: "PUT", path: `/api/app/books/${created.body.id}`, token: jwt, body: { name: "Dune Messiah", type: BookType.ScienceFiction, publishDate: "1969-10-15", price: 13 } });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Dune Messiah", price: 13 });

    expect((await call({ method: "DELETE", path: `/api/app/books/${created.body.id}`, token: jwt })).status).toBe(204);
    expect((await call({ method: "GET", path: `/api/app/books/${created.body.id}`, token: jwt })).status).toBe(404);

    const auditLogs = await inUnitOfWork((p) => p.getRequired(IAuditLogRepository).getList({ url: "/api/app/books", httpMethod: "POST" }));
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs[0]).toMatchObject({ userName: "admin", applicationName: "TemplateApp", httpStatusCode: 200 });
    expect(auditLogs[0]!.actions.map((a) => `${a.serviceName}.${a.methodName}`)).toContain("BookAppService.create");
  });

  it("rejects invalid input with a validation error", async () => {
    const response = await call<{ error: { validationErrors: { members: string[] }[] } }>({ method: "POST", path: "/api/app/books", token: await token("admin"), body: { name: "", type: 99, publishDate: "not-a-date", price: -1 } });
    expect(response.status).toBe(400);
    expect(response.body.error.validationErrors.flatMap((e) => e.members)).toEqual(expect.arrayContaining(["name", "price"]));
  });

  it("answers 401 to anonymous writes and 403 to a user without the permission", async () => {
    const body = { name: "Nope", type: BookType.Horror, publishDate: "2000-01-01", price: 1 };
    const anonymous = await call({ method: "POST", path: "/api/app/books", body });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["www-authenticate"]).toMatch(/Bearer/);

    const bob = await token("bob");
    expect((await call({ method: "GET", path: "/api/app/books", token: bob })).status).toBe(403);
    expect((await call({ method: "POST", path: "/api/app/books", token: bob, body })).status).toBe(403);
  });
});

describe("multi-tenancy", () => {
  it("resolves the __tenant header, signs the tenant admin in and isolates the tenant's books", async () => {
    const tenantJwt = await token("admin", "1q2w3E*", { __tenant: "acme" });
    expect(decodeJwt(tenantJwt)).toMatchObject({ tenantid: acmeTenantId, preferred_username: "admin" });

    const configuration = await call({ method: "GET", path: "/api/abp/application-configuration", token: tenantJwt });
    expect(configuration.body["currentTenant"]).toMatchObject({ isAvailable: true, id: acmeTenantId, name: "acme" });

    const hostJwt = await token("admin");
    await call({ method: "POST", path: "/api/app/books", token: hostJwt, body: { name: "Host only", type: BookType.Biography, publishDate: "2010-01-01", price: 5 } });

    const tenantBooks = await call<PagedResultDto<BookDto>>({ method: "GET", path: "/api/app/books", token: tenantJwt });
    expect(tenantBooks.status).toBe(200);
    expect(tenantBooks.body.items.map((b) => b.name)).not.toContain("Host only");
    expect(tenantBooks.body.totalCount).toBe(2);

    const created = await call<BookDto>({ method: "POST", path: "/api/app/books", token: tenantJwt, body: { name: "Acme handbook", type: BookType.Science, publishDate: "2020-01-01", price: 9 } });
    expect(created.status).toBe(200);
    expect((await call<PagedResultDto<BookDto>>({ method: "GET", path: "/api/app/books", token: hostJwt })).body.items.map((b) => b.name)).not.toContain("Acme handbook");
    expect((await call({ method: "GET", path: `/api/app/books/${created.body.id}`, token: hostJwt })).status).toBe(404);
  });

  it("reports an unknown tenant with the ABP tenant resolve error", async () => {
    const response = await call({ method: "GET", path: "/api/abp/application-configuration", headers: { __tenant: "nobody" } });
    expect(response.status).toBe(404);
    expect(response.headers["abp-tenant-resolve-error"]).toBeDefined();
  });
});

describe("Swagger / OpenAPI", () => {
  it("publishes the OpenAPI document of every controller with the ABP security schemes", async () => {
    const response = await host.handle({ method: "GET", path: "/swagger/v1/swagger.json" });
    expect(response.statusCode).toBe(200);
    const document = JSON.parse(response.bodyText) as OpenApiDocument;
    expect(document.info).toEqual({ title: "TemplateApp API", version: "v1" });
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(["/api/app/books", "/api/app/books/{id}", "/api/identity/users", "/connect/token", "/api/abp/application-configuration"]));

    const create = document.paths["/api/app/books"]?.post;
    expect(create?.requestBody?.content["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/CreateUpdateBookDto" });
    expect(create?.responses["200"]?.content?.["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/BookDto" });
    expect(document.components.schemas["BookDto"]?.properties?.["type"]).toMatchObject({ enum: [0, 1, 2, 3, 4, 5, 6, 7, 8], "x-enumNames": ["Undefined", "Adventure", "Biography", "Dystopia", "Fantasy", "Horror", "Science", "ScienceFiction", "Poetry"] });
    expect(document.paths["/api/app/books/{id}"]?.delete?.responses["204"]).toBeDefined();

    const list = document.paths["/api/app/books"]?.get;
    expect(list?.parameters?.map((parameter) => parameter.name)).toEqual(expect.arrayContaining(["skipCount", "maxResultCount", "sorting"]));
    expect(list?.responses["200"]?.content?.["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/PagedResultDtoOfBookDto" });

    const oauth2 = document.components.securitySchemes?.["oauth2"];
    expect(oauth2?.type === "oauth2" && oauth2.flows.password?.tokenUrl).toBe("/connect/token");
  });

  it("serves the Swagger UI page configured for the TemplateApp OAuth client", async () => {
    const response = await host.handle({ method: "GET", path: "/swagger" });
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.bodyText).toContain("SwaggerUIBundle");
    expect(response.bodyText).toContain("/swagger/v1/swagger.json");
    expect(response.bodyText).toContain(TemplateAppClientId);
  });
});
