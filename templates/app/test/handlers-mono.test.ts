import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { AbpApplication } from "@abp/core";

process.env["ABP_ENVIRONMENT"] = "Development";
process.env["ABP__App__Database"] = "Memory";
process.env["ABP_LOG_LEVEL"] = "None";
process.env["ABP__BackgroundJobs__Aws__QueueUrl"] = "https://sqs.eu-west-2.amazonaws.com/123456789012/NewAbp-dev-JobsQueue";
process.env["ABP__EventBus__Aws__QueueUrl"] = "https://sqs.eu-west-2.amazonaws.com/123456789012/NewAbp-dev-EventsQueue";

const mono = await import("../src/handlers/mono.js");
const { createHostApplication } = await import("../src/application.js");

let app: AbpApplication;
beforeAll(async () => {
  app = await createHostApplication();
});
afterAll(async () => {
  await app.shutdown();
});

function sqsEvent(queue: string, body: unknown): SQSEvent {
  const record = { messageId: "m1", receiptHandle: "r", body: JSON.stringify(body), attributes: {}, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: `arn:aws:sqs:eu-west-2:123456789012:${queue}`, awsRegion: "eu-west-2" } as SQSRecord;
  return { Records: [record] };
}

describe("handlers/mono.ts (single Lambda for everything)", () => {
  it("serves HTTP routes", async () => {
    const event = { version: "2.0", routeKey: "$default", rawPath: "/api/abp/application-configuration", rawQueryString: "", headers: {}, isBase64Encoded: false, requestContext: { http: { method: "GET", path: "/api/abp/application-configuration", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" }, requestId: "r", stage: "$default", time: "", timeEpoch: 0, accountId: "1", apiId: "a", domainName: "d", domainPrefix: "d", routeKey: "$default" } } as APIGatewayProxyEventV2;
    const result = (await mono.handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toHaveProperty("multiTenancy");
  });

  it("consumes the jobs queue by queue name and reports unknown jobs as batch failures", async () => {
    const result = (await mono.handler(sqsEvent("NewAbp-dev-JobsQueue", { jobName: "TemplateApp.Nope", argsJson: "{}", priority: 15, enqueuedAt: new Date().toISOString() }))) as SQSBatchResponse;
    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(["m1"]);
  });

  it("consumes the events queue by queue name", async () => {
    const result = (await mono.handler(sqsEvent("NewAbp-dev-EventsQueue", { eventName: "no.such.event", eventData: "{}", messageId: "x" }))) as SQSBatchResponse;
    expect(result).toHaveProperty("batchItemFailures");
  });

  it("runs the workers on a schedule tick and on direct invoke", async () => {
    const scheduled = (await mono.handler({ source: "aws.events", "detail-type": "Scheduled Event" })) as { backgroundJobWorkerRan: boolean };
    expect(scheduled.backgroundJobWorkerRan).toBe(true);
    const invoked = (await mono.handler({ abp: "workers" })) as { backgroundJobWorkerRan: boolean };
    expect(invoked.backgroundJobWorkerRan).toBe(true);
  });
});
