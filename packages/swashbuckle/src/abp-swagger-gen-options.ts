import type { Class } from "@abp/core";
import type { RouteEntry } from "@abp/aws-lambda";
import type { ResponseSchemaSource } from "./api-explorer.js";
import type { OpenApiDocument, OpenApiOperation, OpenApiSecurityRequirement, OpenApiSecurityScheme, OpenApiServer } from "./openapi-types.js";
import type { SchemaRepository } from "./schema-repository.js";

/** Port of `SwaggerDoc(name, new OpenApiInfo { Title, Version, Description })`. */
export interface SwaggerDocument {
  name: string;
  title: string;
  version: string;
  description?: string;
}

export interface DocumentFilterContext {
  readonly documentName: string;
  readonly entries: readonly RouteEntry[];
  readonly schemaRepository: SchemaRepository;
}

export interface OperationFilterContext {
  readonly documentName: string;
  readonly entry: RouteEntry;
  readonly schemaRepository: SchemaRepository;
}

/** Port of `IDocumentFilter` / `IOperationFilter` as functions. */
export type DocumentFilter = (document: OpenApiDocument, context: DocumentFilterContext) => void;
export type OperationFilter = (operation: OpenApiOperation, context: OperationFilterContext) => void;

/** Port of `AbpSwaggerOidcFlows`. */
export const AbpSwaggerOidcFlows = {
  AuthorizationCode: "authorization_code",
  Implicit: "implicit",
  Password: "password",
  ClientCredentials: "client_credentials",
} as const;

export const DefaultSwaggerDocument: SwaggerDocument = { name: "v1", title: "API", version: "v1" };

/**
 * Port of the `SwaggerGenOptions` configuration ABP applies in `AddAbpSwaggerGen` / `AddAbpSwaggerGenWithOAuth` plus
 * the template's `ConfigureSwaggerServices`. Defaults describe the `@abp/auth-jwt` token endpoint: an `oauth2`
 * password flow at `/connect/token` and a plain `bearer` scheme.
 */
export class AbpSwaggerGenOptions {
  readonly documents: SwaggerDocument[] = [];
  servers: OpenApiServer[] = [];
  securitySchemes: Record<string, OpenApiSecurityScheme> = {
    oauth2: { type: "oauth2", flows: { password: { tokenUrl: "/connect/token", scopes: {} } } },
    bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Paste the access token issued by /connect/token." },
  };
  /** Applied to the whole document and to every operation that carries `@Authorize` (port of `AddSecurityRequirement`). */
  securityRequirements: OpenApiSecurityRequirement[] = [{ oauth2: [] }, { bearer: [] }];
  /** Port of `HideAbpEndpoints()`: drops the framework's own `/api/abp/*` routes from the document. */
  hideAbpEndpoints = true;
  /** Port of `CustomSchemaIds`: the component name of a DTO class (default: the class name). */
  customSchemaIds: ((type: Class) => string) | undefined = undefined;
  /** Port of `DocInclusionPredicate`; ABP templates include every action in every document. */
  docInclusionPredicate: (documentName: string, entry: RouteEntry) => boolean = () => true;
  /**
   * DTO classes referenced only from inside other schemas (a zod schema does not know its owning class), so they
   * become named components instead of inline copies; classes used by bindings or `@Produces` need no entry.
   */
  readonly knownTypes: ResponseSchemaSource[] = [];
  readonly documentFilters: DocumentFilter[] = [];
  readonly operationFilters: OperationFilter[] = [];

  /** Port of `options.SwaggerDoc(name, info)`; a document configured twice keeps the last info. */
  swaggerDoc(name: string, info: Omit<SwaggerDocument, "name">): this {
    const existing = this.documents.findIndex((document) => document.name === name);
    const document: SwaggerDocument = { name, ...info };
    if (existing >= 0) this.documents[existing] = document;
    else this.documents.push(document);
    return this;
  }
}

/** The configured documents, or the single default `v1` document when none was configured. */
export function swaggerDocuments(options: AbpSwaggerGenOptions): readonly SwaggerDocument[] {
  return options.documents.length > 0 ? options.documents : [DefaultSwaggerDocument];
}
