import { BatchGetCommand, BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { AbpCachingModule, DistributedCacheEntryOptions, IDistributedCacheStore, distributedCacheToken } from "@abp/caching";
import { AbpCachingDynamoDbModule, AbpDynamoDbCacheOptions, DynamoDbDistributedCacheStore } from "../src/index.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);

class BookCacheItem {
  constructor(public name: string) {}
}
const bookCache = distributedCacheToken(BookCacheItem);

@DependsOn(AbpCachingDynamoDbModule)
class TestModule extends AbpModule {}

async function createApp(values: Record<string, unknown> = { ConnectionStrings: { Default: "abp-table" } }) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("DynamoDB distributed cache store", () => {
  beforeEach(() => {
    documentClientMock.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("replaces the memory store and reads the table name from ConnectionStrings:Default", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getRequired(IDistributedCacheStore)).toBeInstanceOf(DynamoDbDistributedCacheStore);
    expect(app.serviceProvider.getOptions(AbpDynamoDbCacheOptions).tableName).toBe("abp-table");
    expect(app.modules.some((m) => m.type === AbpCachingModule)).toBe(true);
  });

  it("falls back to ABP_DYNAMODB_TABLE and fails clearly without a table", async () => {
    process.env["ABP_DYNAMODB_TABLE"] = "env-table";
    try {
      const app = await createApp({});
      expect(app.serviceProvider.getOptions(AbpDynamoDbCacheOptions).tableName).toBe("env-table");
    } finally {
      delete process.env["ABP_DYNAMODB_TABLE"];
    }
    const app = await createApp({});
    await expect(app.serviceProvider.getRequired(IDistributedCacheStore).get("k")).rejects.toThrow("tableName is not configured");
  });

  it("writes items with pk/sk, expirations and ttl", async () => {
    const app = await createApp();
    const store = app.serviceProvider.getRequired(IDistributedCacheStore);
    documentClientMock.on(PutCommand).resolves({});
    const value = new TextEncoder().encode("v");
    await store.set("c:Book,k:1", value, new DistributedCacheEntryOptions({ absoluteExpirationRelativeToNow: 60_000, slidingExpiration: 10_000 }));

    const calls = documentClientMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.TableName).toBe("abp-table");
    expect(input.Item).toMatchObject({ pk: "cache#c:Book,k:1", sk: "cache", value, absoluteExpiration: Date.now() + 60_000, slidingExpiration: 10_000, ttl: Math.ceil((Date.now() + 10_000) / 1000) });
  });

  it("returns undefined for missing or ttl-expired items and slides the ttl of sliding entries on read", async () => {
    const app = await createApp();
    const store = app.serviceProvider.getRequired(IDistributedCacheStore);
    documentClientMock.on(GetCommand, { Key: { pk: "cache#missing", sk: "cache" } }).resolves({});
    documentClientMock.on(GetCommand, { Key: { pk: "cache#expired", sk: "cache" } }).resolves({ Item: { pk: "cache#expired", sk: "cache", value: "x", ttl: Math.floor(Date.now() / 1000) - 1 } });
    documentClientMock.on(GetCommand, { Key: { pk: "cache#sliding", sk: "cache" } }).resolves({ Item: { pk: "cache#sliding", sk: "cache", value: "json", slidingExpiration: 5_000, ttl: Math.ceil(Date.now() / 1000) + 2 } });
    documentClientMock.on(UpdateCommand).resolves({});

    expect(await store.get("missing")).toBeUndefined();
    expect(await store.get("expired")).toBeUndefined();
    expect(await store.get("sliding")).toBe("json");

    const updates = documentClientMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args[0].input).toMatchObject({ Key: { pk: "cache#sliding", sk: "cache" }, ExpressionAttributeValues: { ":ttl": Math.ceil((Date.now() + 5_000) / 1000) } });

    await store.refresh("sliding");
    expect(documentClientMock.commandCalls(UpdateCommand)).toHaveLength(2);
    await store.remove("sliding");
    expect(documentClientMock.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({ pk: "cache#sliding", sk: "cache" });
  });

  it("supports batch operations keeping the order of the requested keys", async () => {
    const app = await createApp();
    const store = app.serviceProvider.getRequired(DynamoDbDistributedCacheStore);
    expect(store).toBe(app.serviceProvider.getRequired(IDistributedCacheStore));
    documentClientMock.on(BatchGetCommand).resolves({ Responses: { "abp-table": [{ pk: "cache#b", sk: "cache", value: "B" }, { pk: "cache#a", sk: "cache", value: "A" }] } });
    documentClientMock.on(BatchWriteCommand).resolves({});

    expect(await store.getMany(["a", "b", "c"])).toEqual(["A", "B", undefined]);
    await store.setMany([{ key: "a", value: "1" }, { key: "b", value: "2" }], new DistributedCacheEntryOptions());
    await store.removeMany(["a", "b"]);

    const writes = documentClientMock.commandCalls(BatchWriteCommand);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.args[0].input.RequestItems!["abp-table"]!.map((r) => r.PutRequest!.Item!["pk"])).toEqual(["cache#a", "cache#b"]);
    expect(writes[1]!.args[0].input.RequestItems!["abp-table"]!.map((r) => r.DeleteRequest!.Key!["pk"])).toEqual(["cache#a", "cache#b"]);
  });

  it("serves IDistributedCache<T> round trips through the DynamoDB store", async () => {
    const app = await createApp();
    const cache = app.serviceProvider.getRequired(bookCache);
    let stored: Record<string, unknown> | undefined;
    documentClientMock.on(PutCommand).callsFake((input: { Item: Record<string, unknown> }) => {
      stored = input.Item;
      return {};
    });
    documentClientMock.on(GetCommand).callsFake(() => ({ Item: stored }));

    await cache.set("1", new BookCacheItem("DDD"));
    expect(stored?.["pk"]).toBe("cache#c:Book,k:1");
    const book = await cache.get("1");
    expect(book).toBeInstanceOf(BookCacheItem);
    expect(book?.name).toBe("DDD");
  });
});
