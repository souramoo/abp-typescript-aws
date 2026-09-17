import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { IBlobContainer } from "@abp/blob-storing";
import type { AbpApplication } from "@abp/core";
import { bookCreatedBlobName } from "../src/books/index.js";

process.env["ABP_ENVIRONMENT"] = "Development";
process.env["ABP__App__Database"] = "Memory";
process.env["ABP_LOG_LEVEL"] = "None";

const jobs = await import("../src/handlers/jobs.js");
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


describe("handlers/jobs.ts", () => {
  it("executes the registered BookCreatedJob for an SQS record and reports failed records", async () => {
    const bookId = "0f1e2d3c-4b5a-4968-8776-655443322110";
    const event: SQSEvent = {
      Records: [
        sqsRecord("ok", { jobName: "TemplateApp.BookCreated", argsJson: JSON.stringify({ bookId, name: "Queued book" }), priority: 15, enqueuedAt: new Date().toISOString() }),
        sqsRecord("unknown", { jobName: "TemplateApp.Nope", argsJson: "{}", priority: 15, enqueuedAt: new Date().toISOString() }),
      ],
    };
    const response = await jobs.handler(event);
    expect(response.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(["unknown"]);

    const receipt = await app.serviceProvider.getRequired(IBlobContainer).getOrNull(bookCreatedBlobName(bookId));
    expect(receipt && new TextDecoder().decode(receipt)).toContain('Book "Queued book"');
  });
});
