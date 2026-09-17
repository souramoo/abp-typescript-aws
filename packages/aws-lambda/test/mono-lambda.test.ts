import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, SQSEvent } from "aws-lambda";
import { classifyMonoLambdaEvent, createMonoLambdaHandler, queueNameOf } from "../src/index.js";

const http = { version: "2.0", routeKey: "$default", rawPath: "/x", rawQueryString: "", headers: {}, isBase64Encoded: false, requestContext: { http: { method: "GET", path: "/x" } } } as unknown as APIGatewayProxyEventV2;
const sqs = (arn: string): SQSEvent => ({ Records: [{ messageId: "1", receiptHandle: "r", body: "{}", attributes: {}, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: arn, awsRegion: "eu-west-2" }] }) as unknown as SQSEvent;

describe("mono-lambda dispatcher", () => {
  it("classifies events by shape", () => {
    expect(classifyMonoLambdaEvent(http).kind).toBe("http");
    expect(classifyMonoLambdaEvent(sqs("arn:aws:sqs:eu-west-2:1:jobs"))).toMatchObject({ kind: "sqs", queueName: "jobs" });
    expect(classifyMonoLambdaEvent({ source: "aws.events", "detail-type": "Scheduled Event" }).kind).toBe("scheduled");
    expect(classifyMonoLambdaEvent({ abp: "workers" }).kind).toBe("invoke");
    expect(classifyMonoLambdaEvent({ nope: true }).kind).toBe("unknown");
    expect(queueNameOf("https://sqs.eu-west-2.amazonaws.com/123/my-queue")).toBe("my-queue");
    expect(queueNameOf(undefined)).toBe("");
  });

  it("routes each event kind to its handler and fails loudly otherwise", async () => {
    const calls: string[] = [];
    const handler = createMonoLambdaHandler({
      http: async () => {
        calls.push("http");
        return { statusCode: 200 };
      },
      sqs: {
        jobs: async () => {
          calls.push("jobs");
        },
        "*": async () => {
          calls.push("other");
          return { batchItemFailures: [{ itemIdentifier: "1" }] };
        },
      },
      scheduled: async () => {
        calls.push("scheduled");
        return "tick";
      },
      invoke: { workers: async () => "workers" },
    });
    expect(await handler(http)).toEqual({ statusCode: 200 });
    expect(await handler(sqs("arn:aws:sqs:eu-west-2:1:jobs"))).toEqual({ batchItemFailures: [] });
    expect(await handler(sqs("arn:aws:sqs:eu-west-2:1:events"))).toEqual({ batchItemFailures: [{ itemIdentifier: "1" }] });
    expect(await handler({ source: "aws.events" })).toBe("tick");
    expect(await handler({ abp: "workers" })).toBe("workers");
    await expect(handler({ abp: "nope" })).rejects.toThrow(/no invoke handler/);
    await expect(handler({ bad: 1 } as never)).rejects.toThrow(/unrecognised event shape/);
    expect(calls).toEqual(["http", "jobs", "other", "scheduled"]);
  });
});
