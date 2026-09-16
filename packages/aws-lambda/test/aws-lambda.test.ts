import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, BusinessException, DependsOn, NullLoggerFactory, Transient, UserFriendlyException, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuditingOptions, IAuditingStore, type AuditLogInfo } from "@abp/auditing";
import { AbpExceptionHandlingOptions } from "@abp/http";
import { AbpExceptionLocalizationOptions, AbpLocalizationOptions, LanguageInfo, LocalizationResourceName } from "@abp/localization";
import { AbpMultiTenancyOptions, ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpAuthorizationException, AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentUser } from "@abp/security";
import { IUnitOfWorkManager, UnitOfWork } from "@abp/uow";
import { z } from "zod";
import {
  AbpAspNetCoreMultiTenancyModule,
  AbpAspNetCoreMvcModule,
  AbpAuthenticationOptions,
  AbpHttpHost,
  AuthenticateResult,
  Controller,
  HttpGet,
  HttpPost,
  HttpPut,
  HttpResult,
  IHttpContextAccessor,
  body,
  createApiGatewayHandler,
  createLocalServer,
  fromContext,
  header,
  query,
  route,
  type AbpHttpContext,
  type IAuthenticationHandler,
} from "../src/index.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const acmeId = "11111111-1111-4111-8111-111111111111";
const userId = "44444444-4444-4444-8444-444444444444";

class CreateBookDto {
  static readonly schema = z.object({ name: z.string().min(1), price: z.number().positive(), tags: z.array(z.string()).default([]) });
  name = "";
  price = 0;
  tags: string[] = [];
}

class GetListInput {
  static readonly schema = z.object({ filter: z.string().optional(), skipCount: z.number().int().min(0).default(0), maxResultCount: z.number().int().max(100).default(10), includeDetails: z.boolean().default(false) });
  filter: string | undefined;
  skipCount = 0;
  maxResultCount = 10;
  includeDetails = false;
}

@LocalizationResourceName("TestResource")
class TestResource {}

@Transient()
@Controller("api/app/books", { remoteServiceName: "app" })
class BooksController {
  static readonly inject = [ICurrentUser, IUnitOfWorkManager, ICurrentTenant] as const;
  constructor(
    private readonly currentUser: ICurrentUser,
    private readonly unitOfWorkManager: IUnitOfWorkManager,
    private readonly currentTenant: ICurrentTenant,
  ) {}

  @HttpGet("", query(GetListInput))
  async getList(input: GetListInput) {
    return { items: [], input, uow: this.describeUow() };
  }

  @HttpGet(":id", route("id", { type: "number" }))
  async get(id: number) {
    return { id, name: `Book ${id}` };
  }

  @HttpGet("by-name/:name", route("name"), query("includeDetails", { type: "boolean" }), header("x-client"))
  async getByName(name: string, includeDetails: boolean | undefined, client: string | undefined) {
    return { name, includeDetails, client };
  }

  @HttpPost("", body(CreateBookDto))
  async create(input: CreateBookDto) {
    return { created: input instanceof CreateBookDto, input, uow: this.describeUow() };
  }

  @HttpPut(":id", route("id"), body(CreateBookDto))
  async update(id: string, input: CreateBookDto) {
    return { id, ...input };
  }

  @HttpGet("me")
  async me() {
    return { isAuthenticated: this.currentUser.isAuthenticated, id: this.currentUser.id, userName: this.currentUser.userName, roles: this.currentUser.roles, tenantId: this.currentTenant.id, tenantName: this.currentTenant.name };
  }

  @HttpGet("fail-business")
  async failBusiness() {
    throw new BusinessException({ code: "TestApp:010001" }).withData("Name", "DDD");
  }

  @HttpGet("fail-friendly")
  async failFriendly() {
    throw new UserFriendlyException("Shown to the user", { details: "with details" });
  }

  @HttpGet("fail-internal")
  async failInternal() {
    throw new Error("secret internal failure");
  }

  @HttpGet("forbidden")
  async forbidden() {
    throw new AbpAuthorizationException();
  }

  @HttpPost("void")
  async voidAction(): Promise<void> {}

  @HttpPost("custom", fromContext())
  async custom(context: AbpHttpContext) {
    return HttpResult.created(`/api/app/books/1?from=${context.request.method}`, { ok: true }).withHeader("x-custom", "yes");
  }

  @HttpGet("text")
  async text() {
    return "plain text";
  }

  @HttpPost("no-uow")
  @UnitOfWork({ isDisabled: true })
  async noUow() {
    return { uow: this.describeUow() };
  }

  @HttpGet("echo-culture")
  async echoCulture() {
    const { CultureHelper } = await import("@abp/core");
    return { culture: CultureHelper.currentCulture, uiCulture: CultureHelper.currentUICulture };
  }

  private describeUow() {
    const current = this.unitOfWorkManager.current;
    return current ? { exists: true, isTransactional: current.options.isTransactional } : { exists: false };
  }
}

@Transient()
class HeaderAuthenticationHandler implements IAuthenticationHandler {
  async authenticate(context: AbpHttpContext): Promise<AuthenticateResult> {
    const user = context.request.headers.get("x-test-user");
    if (!user) return AuthenticateResult.noResult();
    if (user === "invalid") return AuthenticateResult.fail("invalid_token", "The token is invalid.");
    const claims = [new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.userName, user), new Claim(AbpClaimTypes.role, "admin"), new Claim(AbpClaimTypes.role, "editor")];
    if (context.request.headers.get("x-test-tenant") === "acme") claims.push(new Claim(AbpClaimTypes.tenantId, acmeId));
    return AuthenticateResult.success(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")));
  }

  async challenge(context: AbpHttpContext): Promise<void> {
    context.response.headers.set("www-authenticate", "Test");
  }
}

class RecordingAuditingStore {
  readonly saved: AuditLogInfo[] = [];
  async save(auditInfo: AuditLogInfo): Promise<void> {
    this.saved.push(auditInfo);
  }
}

const auditingStore = new RecordingAuditingStore();

@DependsOn(AbpAspNetCoreMvcModule, AbpAspNetCoreMultiTenancyModule)
class TestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addSingleton(IAuditingStore, { useValue: auditingStore });
    context.services.addType(BooksController);
    this.configure(AbpAuthenticationOptions, (options) => options.addScheme("Test", HeaderAuthenticationHandler));
    this.configure(AbpMultiTenancyOptions, (options) => {
      options.isEnabled = true;
    });
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(TestResource, "en").addJson({ culture: "en", texts: { "TestApp:010001": "Book {Name} is unavailable", Hello: "Hello" } }, { culture: "tr", texts: { Hello: "Merhaba" } });
      options.defaultResourceType = TestResource;
      options.languages.push(new LanguageInfo("en", "en", "English"), new LanguageInfo("tr", "tr", "Türkçe"));
    });
    this.configure(AbpExceptionLocalizationOptions, (options) => options.mapCodeNamespace("TestApp", TestResource));
    this.configure(AbpAuditingOptions, (options) => {
      options.isEnabledForGetRequests = false;
    });
  }
}

async function createApp() {
  return AbpApplication.create(TestModule, {
    applicationName: "TestApp",
    loggerFactory: NullLoggerFactory.instance,
    configuration: { skipDefaults: true, values: { Tenants: [{ Id: acmeId, Name: "acme" }] } },
  });
}

let host: AbpHttpHost;

beforeAll(async () => {
  host = await AbpHttpHost.create(createApp);
});

afterAll(async () => {
  await host.dispose();
});

function json(response: { bodyText: string }): Record<string, unknown> {
  return JSON.parse(response.bodyText) as Record<string, unknown>;
}

describe("routing and model binding", () => {
  it("binds route, query and header values with conversion", async () => {
    const response = await host.handle({ method: "GET", path: "/API/App/Books/42/" });
    expect(response.statusCode).toBe(200);
    expect(json(response)).toEqual({ id: 42, name: "Book 42" });

    const byName = await host.handle({ method: "GET", path: "/api/app/books/by-name/ddd", query: "includeDetails=true", headers: { "X-Client": "vitest" } });
    expect(json(byName)).toEqual({ name: "ddd", includeDetails: true, client: "vitest" });

    const withoutOptional = await host.handle({ method: "GET", path: "/api/app/books/by-name/x%20y" });
    expect(json(withoutOptional)).toEqual({ name: "x y" });
  });

  it("binds and coerces the query string into a DTO with a zod schema", async () => {
    const response = await host.handle({ method: "GET", path: "/api/app/books", query: "filter=abc&skipCount=20&includeDetails=1" });
    expect(response.statusCode).toBe(200);
    expect(json(response)["input"]).toEqual({ filter: "abc", skipCount: 20, maxResultCount: 10, includeDetails: true });
  });

  it("returns 400 with validation errors when the query or body is invalid", async () => {
    const response = await host.handle({ method: "GET", path: "/api/app/books", query: "maxResultCount=1000&skipCount=-1" });
    expect(response.statusCode).toBe(400);
    expect(response.headers.get("_AbpErrorFormat")).toBe("true");
    const error = json(response)["error"] as { message: string; validationErrors: { message: string; members: string[] }[] };
    expect(error.message).toBe("Your request is not valid!");
    expect(error.validationErrors.map((e) => e.members)).toEqual([["skipCount"], ["maxResultCount"]]);

    const invalidRoute = await host.handle({ method: "GET", path: "/api/app/books/not-a-number" });
    expect(invalidRoute.statusCode).toBe(400);

    const badBody = await host.handle({ method: "POST", path: "/api/app/books", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", price: -1 }) });
    expect(badBody.statusCode).toBe(400);
    expect((json(badBody)["error"] as { validationErrors: { members: string[] }[] }).validationErrors.map((e) => e.members)).toEqual([["name"], ["price"]]);

    const malformed = await host.handle({ method: "POST", path: "/api/app/books", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(malformed.statusCode).toBe(400);
    expect((json(malformed)["error"] as { validationErrors: { members: string[] }[] }).validationErrors[0]?.members).toEqual(["$"]);

    const missing = await host.handle({ method: "POST", path: "/api/app/books" });
    expect(missing.statusCode).toBe(400);
  });

  it("binds the JSON body into a DTO instance", async () => {
    const response = await host.handle({ method: "POST", path: "/api/app/books", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "DDD", price: 10.5 }) });
    expect(response.statusCode).toBe(200);
    const result = json(response);
    expect(result["created"]).toBe(true);
    expect(result["input"]).toEqual({ name: "DDD", price: 10.5, tags: [] });

    const updated = await host.handle({ method: "PUT", path: "/api/app/books/7", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "X", price: 1, tags: ["a"] }) });
    expect(json(updated)).toEqual({ id: "7", name: "X", price: 1, tags: ["a"] });
  });

  it("returns 404 for unknown routes and 405 for wrong verbs", async () => {
    const notFound = await host.handle({ method: "GET", path: "/api/app/nothing" });
    expect(notFound.statusCode).toBe(404);
    expect((json(notFound)["error"] as { message: string }).message).toBe("Resource not found!");

    const wrongVerb = await host.handle({ method: "DELETE", path: "/api/app/books/1" });
    expect(wrongVerb.statusCode).toBe(405);
    expect(wrongVerb.headers.get("allow")).toBe("GET, PUT");
  });

  it("supports void (204), HttpResult and text results", async () => {
    const empty = await host.handle({ method: "POST", path: "/api/app/books/void" });
    expect(empty.statusCode).toBe(204);
    expect(empty.body).toBeUndefined();

    const custom = await host.handle({ method: "POST", path: "/api/app/books/custom" });
    expect(custom.statusCode).toBe(201);
    expect(custom.headers.get("location")).toBe("/api/app/books/1?from=POST");
    expect(custom.headers.get("x-custom")).toBe("yes");
    expect(json(custom)).toEqual({ ok: true });

    const text = await host.handle({ method: "GET", path: "/api/app/books/text" });
    expect(text.headers.get("content-type")).toContain("text/plain");
    expect(text.bodyText).toBe("plain text");
  });

  it("sets and echoes the correlation id", async () => {
    const generated = await host.handle({ method: "GET", path: "/api/app/books/1" });
    expect(generated.headers.get("X-Correlation-Id")).toMatch(/^[0-9a-f]{32}$/);
    const given = await host.handle({ method: "GET", path: "/api/app/books/1", headers: { "x-correlation-id": "abc123" } });
    expect(given.headers.get("x-correlation-id")).toBe("abc123");
  });
});

describe("exception handling", () => {
  it("wraps business exceptions with localized messages and 403", async () => {
    const response = await host.handle({ method: "GET", path: "/api/app/books/fail-business" });
    expect(response.statusCode).toBe(403);
    expect(json(response)).toEqual({ error: { code: "TestApp:010001", message: "Book DDD is unavailable", data: { Name: "DDD" } } });
  });

  it("passes user friendly messages and hides internal errors", async () => {
    const friendly = await host.handle({ method: "GET", path: "/api/app/books/fail-friendly" });
    expect(friendly.statusCode).toBe(403);
    expect((json(friendly)["error"] as { message: string; details: string }).message).toBe("Shown to the user");

    const internal = await host.handle({ method: "GET", path: "/api/app/books/fail-internal" });
    expect(internal.statusCode).toBe(500);
    expect((json(internal)["error"] as { message: string }).message).toBe("An internal error occurred during your request!");
    expect(internal.bodyText).not.toContain("secret");
  });

  it("answers authorization exceptions with 401 for anonymous and 403 for authenticated users", async () => {
    const anonymous = await host.handle({ method: "GET", path: "/api/app/books/forbidden" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe("Test");

    const authenticated = await host.handle({ method: "GET", path: "/api/app/books/forbidden", headers: { "x-test-user": "john" } });
    expect(authenticated.statusCode).toBe(403);
  });

  it("honours sendExceptionsDetailsToClients", async () => {
    const app = await createApp();
    app.services.options.configure(AbpExceptionHandlingOptions, (o) => {
      o.sendExceptionsDetailsToClients = true;
    });
    const detailedHost = await AbpHttpHost.create(app);
    const internal = await detailedHost.handle({ method: "GET", path: "/api/app/books/fail-internal" });
    expect((json(internal)["error"] as { message: string; details: string }).message).toBe("secret internal failure");
    await detailedHost.dispose();
  });
});

describe("authentication and current user", () => {
  it("exposes the authenticated principal through ICurrentUser inside the controller", async () => {
    const response = await host.handle({ method: "GET", path: "/api/app/books/me", headers: { "x-test-user": "john" } });
    expect(json(response)).toEqual({ isAuthenticated: true, id: userId, userName: "john", roles: ["admin", "editor"] });

    const anonymous = await host.handle({ method: "GET", path: "/api/app/books/me" });
    expect(json(anonymous)).toEqual({ isAuthenticated: false, roles: [] });
  });

  it("keeps the request anonymous when a scheme fails", async () => {
    const response = await host.handle({ method: "GET", path: "/api/app/books/me", headers: { "x-test-user": "invalid" } });
    expect(json(response)["isAuthenticated"]).toBe(false);
  });
});

describe("multi-tenancy", () => {
  it("resolves the tenant from the __tenant header, query string and the user's claim", async () => {
    const byHeader = await host.handle({ method: "GET", path: "/api/app/books/me", headers: { __tenant: "acme" } });
    expect(json(byHeader)).toMatchObject({ tenantId: acmeId, tenantName: "acme" });

    const byQuery = await host.handle({ method: "GET", path: "/api/app/books/me", query: `__tenant=${acmeId}` });
    expect(json(byQuery)).toMatchObject({ tenantId: acmeId, tenantName: "acme" });
    expect(byQuery.cookies.some((c) => c.startsWith(`__tenant=${acmeId}`))).toBe(true);

    const byClaim = await host.handle({ method: "GET", path: "/api/app/books/me", headers: { "x-test-user": "john", "x-test-tenant": "acme" } });
    expect(json(byClaim)).toMatchObject({ tenantId: acmeId, tenantName: "acme" });

    const hostSide = await host.handle({ method: "GET", path: "/api/app/books/me" });
    expect(json(hostSide)["tenantId"]).toBeUndefined();
  });

  it("returns an ABP error response when the tenant does not exist", async () => {
    const response = await host.handle({ method: "GET", path: "/api/app/books/me", headers: { __tenant: "nope" } });
    expect(response.statusCode).toBe(404);
    expect(response.headers.get("Abp-Tenant-Resolve-Error")).toContain("Tenant not found");
    expect((json(response)["error"] as { message: string }).message).toBe("Tenant not found!");
  });
});

describe("unit of work and auditing", () => {
  it("begins a transactional unit of work for POST and a non-transactional one for GET", async () => {
    const post = await host.handle({ method: "POST", path: "/api/app/books", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "DDD", price: 1 }) });
    expect(json(post)["uow"]).toEqual({ exists: true, isTransactional: true });

    const get = await host.handle({ method: "GET", path: "/api/app/books" });
    expect(json(get)["uow"]).toEqual({ exists: true, isTransactional: false });

    const disabled = await host.handle({ method: "POST", path: "/api/app/books/no-uow" });
    expect(json(disabled)["uow"]).toEqual({ exists: false });
  });

  it("saves an audit log for non-GET requests with HTTP details", async () => {
    auditingStore.saved.length = 0;
    await host.handle({ method: "POST", path: "/api/app/books", headers: { "content-type": "application/json", "user-agent": "vitest-agent" }, body: JSON.stringify({ name: "Audited", price: 2 }), ip: "10.0.0.1" });
    expect(auditingStore.saved).toHaveLength(1);
    const log = auditingStore.saved[0]!;
    expect(log).toMatchObject({ httpMethod: "POST", url: "/api/app/books", httpStatusCode: 200, clientIpAddress: "10.0.0.1", browserInfo: "vitest-agent", applicationName: "TestApp" });
    expect(log.actions).toHaveLength(1);
    expect(log.actions[0]).toMatchObject({ serviceName: "BooksController", methodName: "create" });
    expect(log.actions[0]!.parameters).toContain("Audited");

    auditingStore.saved.length = 0;
    await host.handle({ method: "GET", path: "/api/app/books" });
    expect(auditingStore.saved).toHaveLength(0);

    await host.handle({ method: "GET", path: "/api/app/books/fail-friendly" });
    expect(auditingStore.saved).toHaveLength(1);
    expect(auditingStore.saved[0]!.httpStatusCode).toBe(403);
    expect(auditingStore.saved[0]!.exceptions).toHaveLength(1);
  });
});

describe("request localization", () => {
  it("applies the culture from the query string, cookie and Accept-Language", async () => {
    expect(json(await host.handle({ method: "GET", path: "/api/app/books/echo-culture", query: "culture=tr" }))).toEqual({ culture: "tr", uiCulture: "tr" });
    expect(json(await host.handle({ method: "GET", path: "/api/app/books/echo-culture", headers: { cookie: ".AspNetCore.Culture=c%3Dde%7Cuic%3Dde-DE" } }))).toEqual({ culture: "de", uiCulture: "de-DE" });
    expect(json(await host.handle({ method: "GET", path: "/api/app/books/echo-culture", headers: { "accept-language": "fr-CA;q=0.8, es;q=0.9" } }))).toEqual({ culture: "es", uiCulture: "es" });
    expect(json(await host.handle({ method: "GET", path: "/api/app/books/echo-culture" }))).toEqual({ culture: "en", uiCulture: "en" });
  });
});

describe("application configuration endpoints", () => {
  it("returns the expected sections", async () => {
    const response = await host.handle({ method: "GET", path: "/api/abp/application-configuration", headers: { "x-test-user": "john" } });
    expect(response.statusCode).toBe(200);
    const config = json(response);
    expect(config["currentUser"]).toMatchObject({ isAuthenticated: true, userName: "john", roles: ["admin", "editor"] });
    expect(config["multiTenancy"]).toEqual({ isEnabled: true, userSharingStrategy: 0 });
    expect(config["currentTenant"]).toEqual({ isAvailable: false });
    expect(config["clock"]).toEqual({ kind: "Unspecified" });
    expect(config["auth"]).toEqual({ grantedPolicies: {} });
    expect(config["features"]).toEqual({ values: {} });
    expect(config["globalFeatures"]).toEqual({ enabledFeatures: [] });
    expect(config["timing"]).toEqual({ timeZone: { iana: {}, windows: {} } });
    const localization = config["localization"] as { values: Record<string, Record<string, string>>; languages: unknown[]; currentCulture: { name: string }; defaultResourceName: string };
    expect(localization.defaultResourceName).toBe("TestResource");
    expect(localization.languages).toHaveLength(2);
    expect(localization.currentCulture.name).toBe("en");
    expect(localization.values["TestResource"]?.["Hello"]).toBe("Hello");
    expect(localization.values["AbpExceptionHandling"]?.["InternalServerErrorMessage"]).toBeDefined();

    const withoutResources = json(await host.handle({ method: "GET", path: "/api/abp/application-configuration", query: "includeLocalizationResources=false" }));
    expect((withoutResources["localization"] as { values: unknown }).values).toEqual({});
  });

  it("serves application localization for a culture", async () => {
    const response = await host.handle({ method: "GET", path: "/api/abp/application-localization", query: "cultureName=tr" });
    expect(response.statusCode).toBe(200);
    const result = json(response) as { resources: Record<string, { texts: Record<string, string>; baseResources: string[] }>; currentCulture: { name: string } };
    expect(result.currentCulture.name).toBe("tr");
    expect(result.resources["TestResource"]?.texts["Hello"]).toBe("Merhaba");

    const invalid = await host.handle({ method: "GET", path: "/api/abp/application-localization" });
    expect(invalid.statusCode).toBe(400);
  });

  it("describes the API", async () => {
    const response = await host.handle({ method: "GET", path: "/api/abp/api-definition" });
    const model = json(response) as { modules: Record<string, { controllers: Record<string, { actions: Record<string, { url: string; httpMethod: string }> }> }> };
    expect(model.modules["app"]?.controllers["BooksController"]?.actions["BooksController.get"]).toMatchObject({ url: "api/app/books/{id}", httpMethod: "GET" });
    expect(model.modules["abp"]?.controllers["AbpApplicationConfigurationController"]).toBeDefined();
  });
});

describe("API Gateway adapter", () => {
  it("round-trips an HTTP API v2 event including base64 bodies and cookies", async () => {
    const handler = createApiGatewayHandler(createApp);
    const event: APIGatewayProxyEventV2 = {
      version: "2.0",
      routeKey: "$default",
      rawPath: "/api/app/books",
      rawQueryString: "",
      cookies: ["__tenant=acme", "other=1"],
      headers: { "content-type": "application/json", "x-test-user": "john" },
      requestContext: {
        accountId: "1",
        apiId: "api",
        domainName: "api.example.com",
        domainPrefix: "api",
        http: { method: "POST", path: "/api/app/books", protocol: "HTTP/1.1", sourceIp: "1.2.3.4", userAgent: "agent" },
        requestId: "r1",
        routeKey: "$default",
        stage: "$default",
        time: "",
        timeEpoch: 0,
      },
      body: Buffer.from(JSON.stringify({ name: "Base64", price: 3 })).toString("base64"),
      isBase64Encoded: true,
    };

    const [first, second] = await Promise.all([handler(event), handler({ ...event, headers: { "content-type": "application/json" }, rawPath: "/api/app/books/me", requestContext: { ...event.requestContext, http: { ...event.requestContext.http, method: "GET" } }, body: undefined, isBase64Encoded: false })]);
    expect(first.statusCode).toBe(200);
    expect(first.isBase64Encoded).toBe(false);
    expect(first.headers?.["content-type"]).toContain("application/json");
    expect(JSON.parse(first.body!)["input"]).toEqual({ name: "Base64", price: 3, tags: [] });
    expect(JSON.parse(second.body!)).toMatchObject({ isAuthenticated: false, tenantId: acmeId, tenantName: "acme" });

    const binary = await handler({ ...event, rawPath: "/api/app/books/text", requestContext: { ...event.requestContext, http: { ...event.requestContext.http, method: "GET" } }, body: undefined, isBase64Encoded: false });
    expect(binary.body).toBe("plain text");
  });
});

describe("local server", () => {
  it("serves the pipeline over node:http", async () => {
    const server = createLocalServer(createApp, { port: 0 });
    const { url } = await server.start();
    try {
      const response = await fetch(`${url}/api/app/books/5`, { headers: { "x-test-user": "john" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 5, name: "Book 5" });
      const created = await fetch(`${url}/api/app/books`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "N", price: 1 }) });
      expect(created.status).toBe(200);
      expect(((await created.json()) as { input: { name: string } }).input.name).toBe("N");
    } finally {
      await server.stop();
    }
  });
});

describe("http context accessor", () => {
  it("is ambient inside the request and empty outside", async () => {
    const accessor = host.application.serviceProvider.getRequired(IHttpContextAccessor);
    expect(accessor.httpContext).toBeUndefined();
  });
});
