import { DeleteCommand, DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { AbpDistributedLockOptions, IAbpDistributedLock, LocalAbpDistributedLock } from "@abp/distributed-locking";
import { AbpDistributedLockingDynamoDbModule, AbpDynamoDbDistributedLockOptions, DynamoDbAbpDistributedLock } from "../src/index.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);

class ConditionalCheckFailedException extends Error {
  override readonly name = "ConditionalCheckFailedException";
}

@DependsOn(AbpDistributedLockingDynamoDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpDistributedLockOptions, (o) => {
      o.keyPrefix = "app:";
    });
    this.configure(AbpDynamoDbDistributedLockOptions, (o) => {
      o.leaseDurationMs = 300;
      o.pollIntervalMs = 20;
      o.renewIntervalMs = 40;
    });
  }
}

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { ConnectionStrings: { Default: "abp-table" } } }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("DynamoDB distributed lock", () => {
  beforeEach(() => documentClientMock.reset());

  it("replaces the local lock", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);
    expect(lock).toBeInstanceOf(DynamoDbAbpDistributedLock);
    expect(lock).not.toBeInstanceOf(LocalAbpDistributedLock);
  });

  it("acquires with a conditional put, renews the lease and releases only its own item", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);
    documentClientMock.on(PutCommand).resolves({});
    documentClientMock.on(UpdateCommand).resolves({});
    documentClientMock.on(DeleteCommand).resolves({});

    const before = Date.now();
    const handle = await lock.tryAcquire("job");
    expect(handle).toBeDefined();

    const put = documentClientMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.TableName).toBe("abp-table");
    expect(put.ConditionExpression).toBe("attribute_not_exists(pk) OR #expires < :now");
    expect(put.Item).toMatchObject({ pk: "lock#app:job", sk: "lock" });
    const item = put.Item as { owner: string; expiresAt: number; ttl: number };
    expect(item.expiresAt).toBeGreaterThanOrEqual(before + 300);
    expect(item.ttl).toBeGreaterThanOrEqual(Math.floor((before + 600) / 1000));

    await new Promise((r) => setTimeout(r, 100));
    const renewals = documentClientMock.commandCalls(UpdateCommand);
    expect(renewals.length).toBeGreaterThanOrEqual(1);
    expect(renewals[0]!.args[0].input).toMatchObject({ Key: { pk: "lock#app:job", sk: "lock" }, ConditionExpression: "#owner = :owner", ExpressionAttributeValues: expect.objectContaining({ ":owner": item.owner }) });

    await handle!.dispose();
    const del = documentClientMock.commandCalls(DeleteCommand)[0]!.args[0].input;
    expect(del).toMatchObject({ Key: { pk: "lock#app:job", sk: "lock" }, ConditionExpression: "#owner = :owner", ExpressionAttributeValues: { ":owner": item.owner } });

    const renewalsAfterDispose = documentClientMock.commandCalls(UpdateCommand).length;
    await new Promise((r) => setTimeout(r, 100));
    expect(documentClientMock.commandCalls(UpdateCommand).length).toBe(renewalsAfterDispose);
    await handle!.dispose();
    expect(documentClientMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it("returns undefined when another owner holds the lock for the whole timeout, and retries until it is free", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);
    documentClientMock.on(PutCommand).rejects(new ConditionalCheckFailedException("held"));

    expect(await lock.tryAcquire("busy")).toBeUndefined();
    expect(documentClientMock.commandCalls(PutCommand)).toHaveLength(1);

    const start = Date.now();
    expect(await lock.tryAcquire("busy", 80)).toBeUndefined();
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
    expect(documentClientMock.commandCalls(PutCommand).length).toBeGreaterThan(2);

    documentClientMock.reset();
    let attempts = 0;
    documentClientMock.on(PutCommand).callsFake(() => {
      attempts++;
      if (attempts < 3) throw new ConditionalCheckFailedException("held");
      return {};
    });
    documentClientMock.on(DeleteCommand).resolves({});
    const handle = await lock.tryAcquire("busy", 1000);
    expect(handle).toBeDefined();
    expect(attempts).toBe(3);
    await handle!.dispose();
  });

  it("ignores a failed ownership check on release and propagates other errors", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);
    documentClientMock.on(PutCommand).resolves({});
    documentClientMock.on(DeleteCommand).rejects(new ConditionalCheckFailedException("taken over"));
    const handle = await lock.tryAcquire("x");
    await expect(handle!.dispose()).resolves.toBeUndefined();

    documentClientMock.on(PutCommand).rejects(new Error("network"));
    await expect(lock.tryAcquire("x")).rejects.toThrow("network");
  });

  it("honours the abort signal while waiting", async () => {
    const app = await createApp();
    const lock = app.serviceProvider.getRequired(IAbpDistributedLock);
    documentClientMock.on(PutCommand).rejects(new ConditionalCheckFailedException("held"));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expect(lock.tryAcquire("busy", 5000, controller.signal)).rejects.toThrow("aborted");
  });
});
