import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SQSRecord } from "aws-lambda";
import type { AbpApplication } from "@abp/core";

process.env["ABP_ENVIRONMENT"] = "Development";
process.env["ABP__App__Database"] = "Memory";
process.env["ABP_LOG_LEVEL"] = "None";

const events = await import("../src/handlers/events.js");
const { createHostApplication } = await import("../src/application.js");

let app: AbpApplication;

beforeAll(async () => {
  app = await createHostApplication();
});

afterAll(async () => {
  await app.shutdown();
});

function sqsRecord(messageId: string, body: unknown): SQSRecord {
  return { messageId, receiptHandle: "r", body: JSON.stringify(body), attributes: {}, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn", awsRegion: "eu-west-2" } as SQSRecord;
}


describe("handlers/events.ts", () => {
  it("reports malformed event records as batch item failures", async () => {
    const response = await events.handler({ Records: [{ ...sqsRecord("bad", "{}"), messageAttributes: {} }] });
    expect(response.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(["bad"]);
  });
});
