import { AbpException, removePreFix } from "@abp/core";

/** Port of `AbpHttpConsts`. */
export const AbpHttpConsts = {
  AbpErrorFormat: "_AbpErrorFormat",
  AbpTenantResolveError: "Abp-Tenant-Resolve-Error",
} as const;

/** Port of `MimeTypes` (the subset the HTTP layer needs). */
export const MimeTypes = {
  Application: {
    Json: "application/json",
    Javascript: "application/javascript",
    FormUrlEncoded: "application/x-www-form-urlencoded",
    OctetStream: "application/octet-stream",
  },
  Text: {
    Plain: "text/plain",
    Html: "text/html",
  },
} as const;

/** Port of `System.Net.HttpStatusCode` (the subset ABP maps exceptions to). */
export enum HttpStatusCode {
  OK = 200,
  Created = 201,
  NoContent = 204,
  MovedPermanently = 301,
  Found = 302,
  NotModified = 304,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  MethodNotAllowed = 405,
  Conflict = 409,
  UnsupportedMediaType = 415,
  TooManyRequests = 429,
  InternalServerError = 500,
  NotImplemented = 501,
  ServiceUnavailable = 503,
}

/** Port of `HttpMethodHelper`. */
export const HttpMethodHelper = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Head: "HEAD",
  Options: "OPTIONS",
  Trace: "TRACE",
  Query: "QUERY",
  DefaultHttpVerb: "POST",

  conventionalPrefixes: new Map<string, string[]>([
    ["GET", ["GetList", "GetAll", "Get"]],
    ["PUT", ["Put", "Update"]],
    ["DELETE", ["Delete", "Remove"]],
    ["POST", ["Create", "Add", "Insert", "Post"]],
    ["PATCH", ["Patch"]],
  ]),

  getConventionalVerbForMethodName(methodName: string): string {
    const lower = methodName.toLowerCase();
    for (const [verb, prefixes] of HttpMethodHelper.conventionalPrefixes) {
      if (prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) return verb;
    }
    return HttpMethodHelper.DefaultHttpVerb;
  },

  removeHttpMethodPrefix(methodName: string, httpMethod: string): string {
    const prefixes = HttpMethodHelper.conventionalPrefixes.get(httpMethod.toUpperCase());
    if (!prefixes || prefixes.length === 0) return methodName;
    return removePreFix(methodName, ...prefixes);
  },

  /** Port of `ConvertToHttpMethod`: normalizes and validates a verb. */
  normalize(httpMethod: string | undefined): string {
    const upper = httpMethod?.toUpperCase();
    switch (upper) {
      case "GET":
      case "POST":
      case "PUT":
      case "DELETE":
      case "OPTIONS":
      case "TRACE":
      case "HEAD":
      case "PATCH":
      case "QUERY":
        return upper;
      default:
        throw new AbpException(`Unknown HTTP METHOD: ${httpMethod}`);
    }
  },

  isGet: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "GET",
  isPost: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "POST",
  isPut: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "PUT",
  isDelete: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "DELETE",
  isPatch: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "PATCH",
  isHead: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "HEAD",
  isOptions: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "OPTIONS",
  isTrace: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "TRACE",
  isQuery: (httpMethod: string | undefined): boolean => httpMethod?.toUpperCase() === "QUERY",
};

/** Port of `AbpAspNetCoreConsts` (shared by hosts and the route conventions). */
export const AbpAspNetCoreConsts = {
  DefaultApiPrefix: "api",
  DefaultIntegrationServiceApiPrefix: "integration-api",
} as const;
