import type { SQSRecord } from "aws-lambda";
import { EventBusConsts } from "@abp/event-bus";

/** SNS message attribute names of a distributed event. */
export const AwsEventMessageAttributes = {
  EventName: "eventName",
  CorrelationId: "correlationId",
  TenantId: "tenantId",
  MessageId: "messageId",
} as const;

/** A distributed event as received from the subscription queue. */
export interface AwsIncomingEventMessage {
  messageId: string;
  eventName: string;
  /** The serialized event data (JSON). */
  eventData: string;
  correlationId: string | undefined;
  tenantId: string | undefined;
}

function attribute(attributes: Record<string, unknown> | undefined, name: string): string | undefined {
  const raw = attributes?.[name];
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as { stringValue?: unknown; StringValue?: unknown; Value?: unknown };
  const candidate = value.stringValue ?? value.StringValue ?? value.Value;
  return typeof candidate === "string" && candidate !== "" ? candidate : undefined;
}

function tryParseSnsEnvelope(body: string): Record<string, unknown> | undefined {
  if (!body.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    return record["Type"] === "Notification" && typeof record["Message"] === "string" ? record : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads an event from an SQS record of the SNS subscription. Supports raw message delivery (the body is the event
 * data, attributes are SQS message attributes) and the SNS envelope (`Type: Notification`, attributes inside).
 */
export function parseSqsEventRecord(record: SQSRecord): AwsIncomingEventMessage {
  const envelope = tryParseSnsEnvelope(record.body);
  const attributes: Record<string, unknown> | undefined = envelope ? (envelope["MessageAttributes"] as Record<string, unknown> | undefined) : (record.messageAttributes as Record<string, unknown> | undefined);
  const eventName = attribute(attributes, AwsEventMessageAttributes.EventName);
  if (eventName === undefined) throw new TypeError(`SQS record ${record.messageId} has no '${AwsEventMessageAttributes.EventName}' message attribute.`);
  const messageId = attribute(attributes, AwsEventMessageAttributes.MessageId) ?? (envelope && typeof envelope["MessageId"] === "string" ? envelope["MessageId"] : record.messageId);
  return {
    messageId,
    eventName,
    eventData: envelope ? (envelope["Message"] as string) : record.body,
    correlationId: attribute(attributes, AwsEventMessageAttributes.CorrelationId) ?? attribute(attributes, EventBusConsts.CorrelationIdHeaderName),
    tenantId: attribute(attributes, AwsEventMessageAttributes.TenantId) ?? attribute(attributes, EventBusConsts.TenantIdHeaderName),
  };
}
