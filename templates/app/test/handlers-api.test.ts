import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { IDataSeeder } from "@abp/data";
import type { PagedResultDto } from "@abp/ddd-application";
import type { AbpApplication } from "@abp/core";
import { BookType, type BookDto } from "../src/books/index.js";
import { TemplateAppLocalModule } from "../src/template-app-local-module.js";
import { TemplateAppClientId } from "../src/template-app-module.js";

process.env["ABP_ENVIRONMENT"] = "Production";
process.env["ABP__App__Database"] = "Memory";
process.env["ABP__Auth__Jwt__SigningKey"] = "handlers-test-signing-key-0123456789abcdef0123456789";
process.env["ABP_LOG_LEVEL"] = "None";

const handlers = await import("../src/handlers/api.js");
const workers = await import("../src/handlers/workers.js");
const { createHostApplication } = await import("../src/application.js");

let app: AbpApplication;

beforeAll(async () => {
  app = await createHostApplication();
  await app.serviceProvider.getRequired(IDataSeeder).seed();
});

afterAll(async () => {
  await app.shutdown();
});

function apiGatewayEvent(init: { method: string; path: string; query?: string; headers?: Record<string, string>; body?: string }): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: init.path,
    rawQueryString: init.query ?? "",
    headers: init.headers ?? {},
    body: init.body,
    isBase64Encoded: false,
    requestContext: {
      accountId: "123456789012",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: { method: init.method, path: init.path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" },
      requestId: "r",
      routeKey: "$default",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  };
}


describe("handlers/api.ts", () => {
  it("chooses the local module from ABP__App__Database over appsettings.Production.json and answers API Gateway v2 events end to end", async () => {
    expect(app.startupModuleType).toBe(TemplateAppLocalModule);

    const tokenResponse = await handlers.handler(
      apiGatewayEvent({
        method: "POST",
        path: "/connect/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "password", username: "admin", password: "1q2w3E*", client_id: TemplateAppClientId }).toString(),
      }),
    );
    expect(tokenResponse.statusCode).toBe(200);
    const { access_token } = JSON.parse(tokenResponse.body!) as { access_token: string };

    const list = await handlers.handler(apiGatewayEvent({ method: "GET", path: "/api/app/books", query: "maxResultCount=1&sorting=name", headers: { authorization: `Bearer ${access_token}` } }));
    expect(list.statusCode).toBe(200);
    expect(list.headers?.["content-type"]).toMatch(/application\/json/);
    const page = JSON.parse(list.body!) as PagedResultDto<BookDto>;
    expect(page.totalCount).toBe(2);
    expect(page.items.map((b) => b.name)).toEqual(["1984"]);

    const created = await handlers.handler(
      apiGatewayEvent({ method: "POST", path: "/api/app/books", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Lambda book", type: BookType.Science, publishDate: "2024-01-01", price: 3 }) }),
    );
    expect(created.statusCode).toBe(200);
    expect((JSON.parse(created.body!) as BookDto).name).toBe("Lambda book");

    const unauthorized = await handlers.handler(apiGatewayEvent({ method: "GET", path: "/api/app/books" }));
    expect(unauthorized.statusCode).toBe(401);
  });
});

describe("handlers/workers.ts", () => {
  it("runs the outbox, inbox and background workers once on the in-memory providers", async () => {
    const summary = await workers.handler({ source: "aws.events" });
    expect(summary).toMatchObject({ outboxEventsSent: 0, inboxEventsProcessed: 0, backgroundJobWorkerRan: true });
    expect(summary.backgroundWorkersRun).toBeGreaterThanOrEqual(1);
  });
});
