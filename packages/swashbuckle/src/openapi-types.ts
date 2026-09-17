/*
 * Minimal OpenAPI 3.0.3 object model: the subset of `Microsoft.OpenApi.Models` Swashbuckle emits for ABP APIs.
 * Schemas keep an extension index signature because they are produced by zod's JSON Schema converter.
 */

export type OpenApiHttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: readonly unknown[];
  nullable?: boolean;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  allOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  [extension: string]: unknown;
}

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required?: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: OpenApiSchema;
  style?: "form" | "simple" | "deepObject" | "spaceDelimited" | "pipeDelimited";
  explode?: boolean;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export type OpenApiSecurityRequirement = Record<string, string[]>;

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: OpenApiSecurityRequirement[];
  deprecated?: boolean;
}

export type OpenApiPathItem = Partial<Record<OpenApiHttpMethod, OpenApiOperation>>;

export interface OpenApiOAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface OpenApiOAuthFlows {
  implicit?: OpenApiOAuthFlow;
  password?: OpenApiOAuthFlow;
  clientCredentials?: OpenApiOAuthFlow;
  authorizationCode?: OpenApiOAuthFlow;
}

export type OpenApiSecurityScheme =
  | { type: "oauth2"; description?: string; flows: OpenApiOAuthFlows }
  | { type: "http"; description?: string; scheme: string; bearerFormat?: string }
  | { type: "apiKey"; description?: string; name: string; in: "query" | "header" | "cookie" }
  | { type: "openIdConnect"; description?: string; openIdConnectUrl: string };

export interface OpenApiComponents {
  schemas: Record<string, OpenApiSchema>;
  securitySchemes?: Record<string, OpenApiSecurityScheme>;
}

export interface OpenApiDocument {
  openapi: "3.0.3";
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  paths: Record<string, OpenApiPathItem>;
  components: OpenApiComponents;
  security?: OpenApiSecurityRequirement[];
  tags?: OpenApiTag[];
}
