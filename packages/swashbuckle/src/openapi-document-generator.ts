import { AbpException, Singleton, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpRouteTableProvider, controllerNameOf, type ParameterBinding, type PrimitiveBindingType, type RouteEntry, type SchemaSource } from "@abp/aws-lambda";
import { AuthorizeMetadata } from "@abp/authorization";
import { HttpStatusCode, MimeTypes } from "@abp/http";
import { AbpSwaggerGenOptions, swaggerDocuments } from "./abp-swagger-gen-options.js";
import { ApiExplorerMetadata, ProducesMetadata, schemaOfSource, type ResponseSchemaSource } from "./api-explorer.js";
import type { OpenApiDocument, OpenApiHttpMethod, OpenApiOperation, OpenApiParameter, OpenApiPathItem, OpenApiRequestBody, OpenApiResponse, OpenApiSchema, OpenApiTag } from "./openapi-types.js";
import { SchemaRepository, componentsPrefix } from "./schema-repository.js";

/** Port of `ISwaggerProvider`: builds (once per document name) the OpenAPI document of the application. */
export interface IOpenApiDocumentGenerator {
  readonly documentNames: readonly string[];
  getDocument(documentName: string): OpenApiDocument;
}
export const IOpenApiDocumentGenerator = createToken<IOpenApiDocumentGenerator>("IOpenApiDocumentGenerator");

const httpMethods: readonly OpenApiHttpMethod[] = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function isOpenApiHttpMethod(value: string): value is OpenApiHttpMethod {
  return (httpMethods as readonly string[]).includes(value);
}

/** `api/app/books/:id`, `{id:guid}`, `{id?}`, `{*path}` → `/api/app/books/{id}`. */
export function toOpenApiPath(template: string): string {
  const segments = template
    .split("/")
    .filter((segment) => segment !== "")
    .map((raw) => {
      if (raw.startsWith("{") && raw.endsWith("}")) {
        const inner = raw.slice(1, -1).replace(/^\*+/, "").replace(/\?$/, "");
        return `{${inner.split(":")[0]!.split("=")[0]!}}`;
      }
      if (raw.startsWith(":")) return `{${raw.slice(1).replace(/\?$/, "")}}`;
      return raw;
    });
  return `/${segments.join("/")}`;
}

/** Port of `RemoteServiceErrorInfo` / `RemoteServiceValidationErrorInfo` / `RemoteServiceErrorResponse` as components. */
export const RemoteServiceErrorSchemas: Readonly<Record<string, OpenApiSchema>> = {
  RemoteServiceValidationErrorInfo: {
    type: "object",
    properties: { message: { type: "string", nullable: true }, members: { type: "array", items: { type: "string" }, nullable: true } },
  },
  RemoteServiceErrorInfo: {
    type: "object",
    properties: {
      code: { type: "string", nullable: true },
      message: { type: "string", nullable: true },
      details: { type: "string", nullable: true },
      data: { type: "object", additionalProperties: {}, nullable: true },
      validationErrors: { type: "array", items: { $ref: `${componentsPrefix}RemoteServiceValidationErrorInfo` }, nullable: true },
    },
  },
  RemoteServiceErrorResponse: {
    type: "object",
    properties: { error: { $ref: `${componentsPrefix}RemoteServiceErrorInfo` } },
  },
};

const reasonPhrases: Readonly<Record<number, string>> = {
  [HttpStatusCode.OK]: "Success",
  [HttpStatusCode.Created]: "Created",
  [HttpStatusCode.NoContent]: "No Content",
  [HttpStatusCode.BadRequest]: "Bad Request",
  [HttpStatusCode.Unauthorized]: "Unauthorized",
  [HttpStatusCode.Forbidden]: "Forbidden",
  [HttpStatusCode.NotFound]: "Not Found",
  [HttpStatusCode.InternalServerError]: "Server Error",
};

function reasonPhrase(statusCode: number): string {
  return reasonPhrases[statusCode] ?? "Response";
}

function scalarSchema(type: PrimitiveBindingType): OpenApiSchema {
  switch (type) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "guid":
      return { type: "string", format: "uuid" };
    case "date":
      return { type: "string", format: "date-time" };
    default: {
      const _exhaustive: never = type;
      throw new AbpException(`Unknown binding type ${String(_exhaustive)}`);
    }
  }
}

/** The DTO classes and named schemas an action touches (bindings + `@Produces`). */
function schemaSourcesOf(entry: RouteEntry): (ResponseSchemaSource | undefined)[] {
  const sources: (ResponseSchemaSource | undefined)[] = entry.action.bindings.map((binding) => ("dto" in binding ? binding.dto : undefined));
  for (const produces of ProducesMetadata.get(entry.controllerType, entry.action.name)) sources.push(produces.source);
  return sources;
}

/** Port of ABP's tag-by-remote-service grouping: `[RemoteService(Name)]`, else the `[Area]`, else the controller name. */
export function tagOf(entry: RouteEntry): string {
  return entry.controller.remoteServiceName ?? entry.controller.area ?? controllerNameOf(entry.controllerType);
}

/**
 * Port of `SwaggerGenerator`: walks the route table of `AbpAspNetCoreMvcModule` (every `@Controller` class) and
 * describes each action from its decorators: route/query/header bindings become parameters, `query(Dto)` is
 * expanded into one parameter per schema property (like `[FromQuery]` complex binding), `body()`/`form()` become the
 * request body, `@Produces` the success responses, `@Authorize`/`@AllowAnonymous` the security requirements.
 */
@Singleton(IOpenApiDocumentGenerator)
export class OpenApiDocumentGenerator implements IOpenApiDocumentGenerator {
  static readonly inject = [AbpRouteTableProvider, optionsToken(AbpSwaggerGenOptions)] as const;
  private readonly cache = new Map<string, OpenApiDocument>();

  constructor(
    private readonly routeTable: AbpRouteTableProvider,
    private readonly options: IOptions<AbpSwaggerGenOptions>,
  ) {}

  get documentNames(): readonly string[] {
    return swaggerDocuments(this.options.value).map((document) => document.name);
  }

  getDocument(documentName: string): OpenApiDocument {
    let document = this.cache.get(documentName);
    if (!document) {
      document = this.generate(documentName);
      this.cache.set(documentName, document);
    }
    return document;
  }

  protected generate(documentName: string): OpenApiDocument {
    const options = this.options.value;
    const info = swaggerDocuments(options).find((document) => document.name === documentName);
    if (!info) throw new AbpException(`Unknown Swagger document '${documentName}'. Configure it with AbpSwaggerGenOptions.swaggerDoc(...).`);

    const repository = new SchemaRepository(options.customSchemaIds);
    for (const [name, schema] of Object.entries(RemoteServiceErrorSchemas)) repository.add(name, schema);
    const entries = this.routeTable.value.routes.filter((entry) => this.includes(entry, documentName, options));
    for (const source of options.knownTypes) repository.declare(source);
    for (const entry of entries) for (const source of schemaSourcesOf(entry)) repository.declare(source);

    const paths: Record<string, OpenApiPathItem> = {};
    const tags = new Map<string, OpenApiTag>();
    for (const entry of entries) {
      const method = entry.httpMethod.toLowerCase();
      if (!isOpenApiHttpMethod(method)) continue;
      const item = (paths[toOpenApiPath(entry.template)] ??= {});
      if (item[method]) continue;
      const operation = this.createOperation(entry, repository, options);
      for (const filter of options.operationFilters) filter(operation, { documentName, entry, schemaRepository: repository });
      item[method] = operation;
      for (const tag of operation.tags ?? []) if (!tags.has(tag)) tags.set(tag, { name: tag });
    }

    const document: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: info.title, version: info.version, ...(info.description !== undefined ? { description: info.description } : {}) },
      ...(options.servers.length > 0 ? { servers: [...options.servers] } : {}),
      paths,
      components: { schemas: repository.schemas, securitySchemes: { ...options.securitySchemes } },
      ...(options.securityRequirements.length > 0 ? { security: options.securityRequirements.map((requirement) => ({ ...requirement })) } : {}),
      tags: [...tags.values()],
    };
    for (const filter of options.documentFilters) filter(document, { documentName, entries, schemaRepository: repository });
    return document;
  }

  protected includes(entry: RouteEntry, documentName: string, options: AbpSwaggerGenOptions): boolean {
    if (ApiExplorerMetadata.isIgnored(entry.controllerType)) return false;
    const path = toOpenApiPath(entry.template);
    if (options.hideAbpEndpoints && (path === "/api/abp" || path.startsWith("/api/abp/"))) return false;
    return options.docInclusionPredicate(documentName, entry);
  }

  protected createOperation(entry: RouteEntry, repository: SchemaRepository, options: AbpSwaggerGenOptions): OpenApiOperation {
    const type = entry.controllerType;
    const actionName = entry.action.name;
    const parameters: OpenApiParameter[] = [];
    let requestBody: OpenApiRequestBody | undefined;

    for (const binding of entry.action.bindings) {
      const described = this.describeBinding(binding, repository);
      parameters.push(...described.parameters);
      requestBody = described.requestBody ?? requestBody;
    }
    for (const segment of entry.segments) {
      if (segment.kind === "parameter" && !parameters.some((parameter) => parameter.in === "path" && parameter.name === segment.value)) {
        parameters.push({ name: segment.value, in: "path", required: true, schema: { type: "string" } });
      }
    }

    const anonymous = AuthorizeMetadata.allowsAnonymous(type, actionName);
    const authorized = AuthorizeMetadata.getForClass(type).length > 0 || AuthorizeMetadata.getForMethod(type, actionName).length > 0;

    const operation: OpenApiOperation = {
      tags: [tagOf(entry)],
      operationId: `${controllerNameOf(type)}_${actionName}`,
      parameters,
      ...(requestBody ? { requestBody } : {}),
      responses: this.createResponses(entry, repository, anonymous),
    };
    if (anonymous) operation.security = [];
    else if (authorized) operation.security = options.securityRequirements.map((requirement) => ({ ...requirement }));
    return operation;
  }

  protected describeBinding(binding: ParameterBinding, repository: SchemaRepository): { parameters: OpenApiParameter[]; requestBody?: OpenApiRequestBody } {
    switch (binding.source) {
      case "route":
        return { parameters: [{ name: binding.name, in: "path", required: true, schema: binding.schema ? repository.convert(binding.schema, "input") : scalarSchema(binding.type) }] };
      case "query":
        return { parameters: [{ name: binding.name, in: "query", required: !binding.optional, schema: binding.schema ? repository.convert(binding.schema, "input") : scalarSchema(binding.type) }] };
      case "header":
        return { parameters: [{ name: binding.name, in: "header", required: !binding.optional, schema: binding.schema ? repository.convert(binding.schema, "input") : scalarSchema(binding.type) }] };
      case "queryObject":
        return { parameters: this.expandQueryObject(binding.dto, repository) };
      case "body":
        return { parameters: [], requestBody: { required: !binding.optional, content: { [MimeTypes.Application.Json]: { schema: repository.getOrAdd(binding.dto, "input") } } } };
      case "form":
        return { parameters: [], requestBody: { required: true, content: { [MimeTypes.Application.FormUrlEncoded]: { schema: repository.getOrAdd(binding.dto, "input") } } } };
      case "context":
      case "services":
        return { parameters: [] };
      default: {
        const _exhaustive: never = binding;
        throw new AbpException(`Unknown binding ${String(_exhaustive)}`);
      }
    }
  }

  /** `[FromQuery] SomeDto input`: every top-level property of the DTO's schema is its own query parameter. */
  protected expandQueryObject(dto: SchemaSource | undefined, repository: SchemaRepository): OpenApiParameter[] {
    const schema = schemaOfSource(dto);
    if (!schema) return [];
    const json = repository.convert(schema, "input");
    const required = new Set(json.required ?? []);
    return Object.entries(json.properties ?? {}).map(([name, property]) => ({
      name,
      in: "query",
      required: required.has(name),
      schema: property,
      ...(property.type === "array" ? { style: "form", explode: true } : property.type === "object" ? { style: "deepObject", explode: true } : {}),
    }));
  }

  protected createResponses(entry: RouteEntry, repository: SchemaRepository, anonymous: boolean): Record<string, OpenApiResponse> {
    const responses: Record<string, OpenApiResponse> = {};
    const produces = ProducesMetadata.get(entry.controllerType, entry.action.name);
    if (produces.length === 0) responses[String(HttpStatusCode.OK)] = { description: reasonPhrase(HttpStatusCode.OK), content: { [MimeTypes.Application.Json]: { schema: {} } } };
    for (const response of produces) {
      responses[String(response.statusCode)] =
        response.source === undefined
          ? { description: reasonPhrase(response.statusCode) }
          : { description: reasonPhrase(response.statusCode), content: { [response.contentType]: { schema: repository.getOrAdd(response.source, "output") } } };
    }
    const errorStatusCodes = anonymous ? [HttpStatusCode.BadRequest, HttpStatusCode.NotFound, HttpStatusCode.InternalServerError] : [HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.InternalServerError];
    for (const statusCode of errorStatusCodes) {
      responses[String(statusCode)] ??= { description: reasonPhrase(statusCode), content: { [MimeTypes.Application.Json]: { schema: { $ref: `${componentsPrefix}RemoteServiceErrorResponse` } } } };
    }
    return responses;
  }
}
