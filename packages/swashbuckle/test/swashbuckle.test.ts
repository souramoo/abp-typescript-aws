import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Transient, type ServiceConfigurationContext } from "@abp/core";
import { AllowAnonymous, Authorize } from "@abp/authorization";
import { AbpAspNetCoreMvcModule, AbpHttpHost, AbpRouteTableProvider, Controller, HttpDelete, HttpGet, HttpPost, HttpPut, body, form, header, query, route } from "@abp/aws-lambda";
import { z } from "zod";
import {
  AbpSwaggerGenOptions,
  AbpSwaggerUIOptions,
  AbpSwashbuckleModule,
  ApiExplorerSettings,
  IOpenApiDocumentGenerator,
  OpenApiDocumentGenerator,
  Produces,
  ProducesNoContent,
  pagedResultOf,
  toOpenApiPath,
  type OpenApiDocument,
  type OpenApiOperation,
} from "../src/index.js";

enum BookType {
  Undefined = 0,
  Fantasy = 1,
}

class AuthorDto {
  static readonly schema = z.object({ name: z.string() });
}

class BookDto {
  static readonly schema = z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.nativeEnum(BookType),
    publishDate: z.date(),
    price: z.number(),
    author: AuthorDto.schema.nullish(),
  });
}

class CreateBookDto {
  static readonly schema = z.object({
    name: z.string().min(1),
    type: z.nativeEnum(BookType).default(BookType.Undefined),
    publishDate: z.coerce.date(),
    price: z.number().min(0),
    tags: z.array(z.string()).default([]),
  });
}

class GetBooksInput {
  static readonly schema = z.object({
    filter: z.string().optional(),
    skipCount: z.number().int().min(0).default(0),
    maxResultCount: z.number().int().default(10),
    type: z.nativeEnum(BookType).optional(),
  });
}

@Transient()
@Authorize("Books.Default")
@Controller("api/test/books", { remoteServiceName: "TestApp" })
class BooksController {
  @HttpGet(":id", route("id", { type: "guid" }))
  @Produces(BookDto)
  async get(id: string) {
    return { id };
  }

  @HttpGet("", query(GetBooksInput))
  @Produces(pagedResultOf(BookDto))
  @AllowAnonymous()
  async getList(input: GetBooksInput) {
    return { totalCount: 0, items: [], input };
  }

  @HttpPost("", body(CreateBookDto))
  @Produces(BookDto, { statusCode: 201 })
  @Authorize("Books.Create")
  async create(input: CreateBookDto) {
    return input;
  }

  @HttpPut(":id", route("id", { type: "guid" }), body(CreateBookDto))
  @Produces(BookDto)
  async update(id: string, input: CreateBookDto) {
    return { id, ...input };
  }

  @HttpDelete(":id", route("id", { type: "guid" }))
  @ProducesNoContent()
  async delete(_id: string): Promise<void> {}

  @HttpGet("by-name/:name", route("name"), query("includeDetails", { type: "boolean" }), header("x-client"), query("sort", { schema: z.enum(["asc", "desc"]) }))
  async getByName(name: string, includeDetails: boolean | undefined, client: string | undefined, sort: string | undefined) {
    return { name, includeDetails, client, sort };
  }

  @HttpPost("import", form(CreateBookDto))
  async import(input: CreateBookDto) {
    return input;
  }

  @HttpGet("untyped")
  async untyped() {
    return { anything: true };
  }

  @HttpPost("raw", body())
  async raw(input: unknown) {
    return input;
  }
}

@Transient()
@Controller("api/abp/test-things")
class AbpThingsController {
  @HttpGet("")
  async get() {
    return {};
  }
}

@Transient()
@ApiExplorerSettings({ ignoreApi: true })
@Controller("api/test/hidden")
class HiddenController {
  @HttpGet("")
  async get() {
    return {};
  }
}

@Transient()
@Controller("api/test/legacy", { area: "legacy" })
class LegacyController {
  @HttpGet("{id:int}")
  async get() {
    return {};
  }
}

let operationFilterCalls = 0;

@DependsOn(AbpAspNetCoreMvcModule, AbpSwashbuckleModule)
class TestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    for (const controller of [BooksController, AbpThingsController, HiddenController, LegacyController]) context.services.addType(controller);
    this.configure(AbpSwaggerGenOptions, (options) => {
      options.swaggerDoc("v1", { title: "Test API", version: "v1", description: "The test document" });
      options.hideAbpEndpoints = false;
      options.knownTypes.push(AuthorDto);
      options.operationFilters.push(() => {
        operationFilterCalls++;
      });
    });
    this.configure(AbpSwaggerUIOptions, (options) => {
      options.oauthClientId = "Test_App";
      options.documentTitle = "Test Swagger";
    });
  }
}

let app: AbpApplication;
let host: AbpHttpHost;

beforeAll(async () => {
  app = await AbpApplication.create(TestModule, { applicationName: "TestApp", loggerFactory: NullLoggerFactory.instance, configuration: { skipDefaults: true } });
  host = await AbpHttpHost.create(app);
});

afterAll(async () => {
  await host.dispose();
});

async function fetchDocument(): Promise<OpenApiDocument> {
  const response = await host.handle({ method: "GET", path: "/swagger/v1/swagger.json" });
  expect(response.statusCode, response.bodyText).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  return JSON.parse(response.bodyText) as OpenApiDocument;
}

function operation(document: OpenApiDocument, path: string, method: "get" | "post" | "put" | "delete"): OpenApiOperation {
  const found = document.paths[path]?.[method];
  expect(found, `${method.toUpperCase()} ${path}`).toBeDefined();
  return found!;
}

describe("OpenAPI document", () => {
  it("describes the configured document and lists every controller route as an OpenAPI path", async () => {
    const document = await fetchDocument();
    expect(document.openapi).toBe("3.0.3");
    expect(document.info).toEqual({ title: "Test API", version: "v1", description: "The test document" });
    const paths = Object.keys(document.paths);
    expect(paths.filter((path) => !path.startsWith("/api/abp/")).sort()).toEqual(["/api/test/books", "/api/test/books/by-name/{name}", "/api/test/books/import", "/api/test/books/raw", "/api/test/books/untyped", "/api/test/books/{id}", "/api/test/legacy/{id}"]);
    expect(paths).toEqual(expect.arrayContaining(["/api/abp/test-things", "/api/abp/application-configuration", "/api/abp/api-definition"]));
    expect(paths.some((path) => path.startsWith("/swagger"))).toBe(false);
    expect(paths).not.toContain("/api/test/hidden");
    expect(document.tags?.map((tag) => tag.name)).toEqual(expect.arrayContaining(["TestApp", "legacy", "AbpThings"]));
  });

  it("maps route, query and header bindings to typed parameters", async () => {
    const document = await fetchDocument();
    const get = operation(document, "/api/test/books/{id}", "get");
    expect(get.operationId).toBe("Books_get");
    expect(get.tags).toEqual(["TestApp"]);
    expect(get.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }]);

    const byName = operation(document, "/api/test/books/by-name/{name}", "get");
    expect(byName.parameters).toEqual([
      { name: "name", in: "path", required: true, schema: { type: "string" } },
      { name: "includeDetails", in: "query", required: false, schema: { type: "boolean" } },
      { name: "x-client", in: "header", required: false, schema: { type: "string" } },
      { name: "sort", in: "query", required: false, schema: { type: "string", enum: ["asc", "desc"], "x-enumNames": ["asc", "desc"] } },
    ]);

    const legacy = operation(document, "/api/test/legacy/{id}", "get");
    expect(legacy.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
    expect(legacy.tags).toEqual(["legacy"]);
  });

  it("expands a query DTO into one parameter per schema property", async () => {
    const list = operation(await fetchDocument(), "/api/test/books", "get");
    expect(list.parameters?.map((parameter) => [parameter.name, parameter.in, parameter.required])).toEqual([
      ["filter", "query", false],
      ["skipCount", "query", false],
      ["maxResultCount", "query", false],
      ["type", "query", false],
    ]);
    expect(list.parameters?.find((parameter) => parameter.name === "skipCount")?.schema).toMatchObject({ type: "integer", minimum: 0, default: 0 });
    expect(list.parameters?.find((parameter) => parameter.name === "type")?.schema).toMatchObject({ enum: [0, 1], "x-enumNames": ["Undefined", "Fantasy"] });
  });

  it("describes JSON, form and untyped request bodies", async () => {
    const document = await fetchDocument();
    expect(operation(document, "/api/test/books", "post").requestBody).toEqual({ required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateBookDto" } } } });
    expect(operation(document, "/api/test/books/import", "post").requestBody).toEqual({ required: true, content: { "application/x-www-form-urlencoded": { schema: { $ref: "#/components/schemas/CreateBookDto" } } } });
    expect(operation(document, "/api/test/books/raw", "post").requestBody).toEqual({ required: true, content: { "application/json": { schema: {} } } });
  });

  it("emits the @Produces responses, 204 for no-content actions and the ABP error responses", async () => {
    const document = await fetchDocument();
    const create = operation(document, "/api/test/books", "post");
    expect(create.responses["201"]).toEqual({ description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/BookDto" } } } });
    expect(create.responses["200"]).toBeUndefined();
    expect(Object.keys(create.responses).sort()).toEqual(["201", "400", "401", "403", "404", "500"]);
    expect(create.responses["400"]?.content?.["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/RemoteServiceErrorResponse" });

    expect(operation(document, "/api/test/books/{id}", "delete").responses["204"]).toEqual({ description: "No Content" });
    expect(operation(document, "/api/test/books/untyped", "get").responses["200"]).toEqual({ description: "Success", content: { "application/json": { schema: {} } } });

    const list = operation(document, "/api/test/books", "get");
    expect(list.responses["200"]?.content?.["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/PagedResultDtoOfBookDto" });
    expect(Object.keys(list.responses).sort()).toEqual(["200", "400", "404", "500"]);
  });

  it("puts security requirements on @Authorize operations and none on @AllowAnonymous ones", async () => {
    const document = await fetchDocument();
    expect(document.security).toEqual([{ oauth2: [] }, { bearer: [] }]);
    expect(operation(document, "/api/test/books", "post").security).toEqual([{ oauth2: [] }, { bearer: [] }]);
    expect(operation(document, "/api/test/books/{id}", "get").security).toEqual([{ oauth2: [] }, { bearer: [] }]);
    expect(operation(document, "/api/test/books", "get").security).toEqual([]);
    expect(operation(document, "/api/abp/test-things", "get").security).toBeUndefined();
    expect(document.components.securitySchemes?.["oauth2"]).toEqual({ type: "oauth2", flows: { password: { tokenUrl: "/connect/token", scopes: {} } } });
    expect(document.components.securitySchemes?.["bearer"]).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("builds component schemas from zod with nested DTO references, enums, dates and uuids", async () => {
    const { schemas } = (await fetchDocument()).components;
    expect(Object.keys(schemas).sort()).toEqual(["AuthorDto", "BookDto", "CreateBookDto", "PagedResultDtoOfBookDto", "RemoteServiceErrorInfo", "RemoteServiceErrorResponse", "RemoteServiceValidationErrorInfo"]);
    expect(schemas["BookDto"]?.properties).toMatchObject({
      id: { type: "string", format: "uuid" },
      publishDate: { type: "string", format: "date-time" },
      type: { type: "number", enum: [0, 1], "x-enumNames": ["Undefined", "Fantasy"] },
      author: { allOf: [{ $ref: "#/components/schemas/AuthorDto" }], nullable: true },
    });
    expect(schemas["AuthorDto"]).toMatchObject({ type: "object", properties: { name: { type: "string" } } });
    expect(schemas["PagedResultDtoOfBookDto"]?.properties).toEqual({ totalCount: { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 }, items: { type: "array", items: { $ref: "#/components/schemas/BookDto" } } });
    expect(schemas["CreateBookDto"]?.required).toEqual(["name", "publishDate", "price"]);
    expect(schemas["CreateBookDto"]?.properties?.["tags"]).toEqual({ default: [], type: "array", items: { type: "string" } });
    expect(schemas["RemoteServiceErrorResponse"]?.properties?.["error"]).toEqual({ $ref: "#/components/schemas/RemoteServiceErrorInfo" });
  });

  it("hides the framework's /api/abp endpoints when hideAbpEndpoints is on and honours custom schema ids", () => {
    const options = new AbpSwaggerGenOptions();
    options.customSchemaIds = (type) => `Test.${type.name}`;
    const generator = new OpenApiDocumentGenerator(app.serviceProvider.getRequired(AbpRouteTableProvider), { value: options });
    const document = generator.getDocument("v1");
    expect(document.info.title).toBe("API");
    expect(Object.keys(document.paths)).not.toContain("/api/abp/test-things");
    expect(Object.keys(document.paths)).toContain("/api/test/books");
    expect(operation(document, "/api/test/books", "post").requestBody?.content["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/Test.CreateBookDto" });
    expect(document.components.schemas["Test.BookDto"]).toBeDefined();
    expect(() => generator.getDocument("v2")).toThrow(/Unknown Swagger document 'v2'/);
  });

  it("generates each document once per application and applies document filters", async () => {
    const generator = app.serviceProvider.getRequired(IOpenApiDocumentGenerator);
    const first = generator.getDocument("v1");
    const calls = operationFilterCalls;
    expect(calls).toBeGreaterThan(0);
    expect(generator.getDocument("v1")).toBe(first);
    expect(await fetchDocument()).toEqual(first);
    expect(operationFilterCalls).toBe(calls);

    const options = new AbpSwaggerGenOptions();
    options.documentFilters.push((document, context) => {
      document.info.description = `${context.entries.length} actions`;
      context.schemaRepository.add("Extra", { type: "string" });
    });
    const filtered = new OpenApiDocumentGenerator(app.serviceProvider.getRequired(AbpRouteTableProvider), { value: options }).getDocument("v1");
    expect(filtered.info.description).toMatch(/^\d+ actions$/);
    expect(filtered.components.schemas["Extra"]).toEqual({ type: "string" });
  });

  it("converts route templates to OpenAPI paths", () => {
    expect(toOpenApiPath("api/app/books/:id")).toBe("/api/app/books/{id}");
    expect(toOpenApiPath("api/app/books/{id:guid}/items/{name?}")).toBe("/api/app/books/{id}/items/{name}");
    expect(toOpenApiPath("files/{*path}")).toBe("/files/{path}");
    expect(toOpenApiPath("")).toBe("/");
  });
});

describe("Swagger UI endpoints", () => {
  it("serves the Swagger UI page with the CDN assets, the document list and the OAuth client", async () => {
    for (const path of ["/swagger", "/swagger/index.html"]) {
      const response = await host.handle({ method: "GET", path });
      expect(response.statusCode).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.bodyText).toContain("SwaggerUIBundle(");
      expect(response.bodyText).toContain("https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js");
      expect(response.bodyText).toContain('"url":"/swagger/v1/swagger.json"');
      expect(response.bodyText).toContain('"clientId":"Test_App"');
      expect(response.bodyText).toContain("<title>Test Swagger</title>");
      expect(response.bodyText).toContain('id="abp-tenant"');
      expect(response.bodyText).toContain("oauth2RedirectPath\":\"/swagger/oauth2-redirect.html\"");
    }
  });

  it("serves ABP's oauth2 redirect page and 404 for an unknown document", async () => {
    const redirect = await host.handle({ method: "GET", path: "/swagger/oauth2-redirect.html" });
    expect(redirect.statusCode).toBe(200);
    expect(redirect.bodyText).toContain("abp_swagger_oauth2");

    const unknown = await host.handle({ method: "GET", path: "/swagger/v9/swagger.json" });
    expect(unknown.statusCode).toBe(404);
    expect(JSON.parse(unknown.bodyText)).toMatchObject({ error: { message: "The Swagger document 'v9' is not configured." } });
  });
});
