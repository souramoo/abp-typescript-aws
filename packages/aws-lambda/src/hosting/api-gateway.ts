import type { IAbpApplication } from "@abp/core";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context as LambdaContext } from "aws-lambda";
import { AbpHttpRequest, HttpHeaders, type AbpHttpResponse } from "../http-context.js";
import { cachedHost, type AbpHttpHostOptions } from "./abp-http-host.js";

export type ApiGatewayHandler = (event: APIGatewayProxyEventV2, context?: LambdaContext) => Promise<APIGatewayProxyStructuredResultV2>;

/** Converts an API Gateway HTTP API v2 (or Lambda Function URL) event into an `AbpHttpRequest`. */
export function toAbpHttpRequest(event: APIGatewayProxyEventV2): AbpHttpRequest {
  const headers = new HttpHeaders();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.append(name, value);
  }
  if (event.cookies && event.cookies.length > 0) headers.set("cookie", event.cookies.join("; "));
  return new AbpHttpRequest({
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.rawQueryString ?? "",
    headers,
    body: event.body,
    isBase64Encoded: event.isBase64Encoded,
    ip: event.requestContext.http.sourceIp,
    host: event.requestContext.domainName,
    scheme: headers.get("x-forwarded-proto") ?? "https",
  });
}

/** Converts an `AbpHttpResponse` into the API Gateway v2 structured result (binary bodies are base64-encoded). */
export function toApiGatewayResult(response: AbpHttpResponse): APIGatewayProxyStructuredResultV2 {
  const body = response.body;
  const result: APIGatewayProxyStructuredResultV2 = {
    statusCode: response.statusCode,
    headers: response.headers.toRecord(),
    isBase64Encoded: false,
  };
  if (body !== undefined) {
    if (typeof body === "string") result.body = body;
    else {
      result.body = Buffer.from(body).toString("base64");
      result.isBase64Encoded = true;
    }
  }
  if (response.cookies.length > 0) result.cookies = [...response.cookies];
  return result;
}

/**
 * Creates the Lambda handler for API Gateway HTTP API v2 / Function URL events. The application is created once per
 * container by `appFactory` (concurrent cold-start invocations await the same promise) and every event runs in its
 * own DI scope.
 */
export function createApiGatewayHandler(appFactory: () => Promise<IAbpApplication>, options: AbpHttpHostOptions = {}): ApiGatewayHandler {
  const getHost = cachedHost(appFactory, options);
  return async (event, lambdaContext) => {
    const host = await getHost();
    const controller = new AbortController();
    const response = await host.handle(toAbpHttpRequest(event), { abortSignal: controller.signal, hostEvent: { event, lambdaContext } });
    return toApiGatewayResult(response);
  };
}
