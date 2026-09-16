import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Transient, createToken, type IServiceProvider } from "@abp/core";
import { AbpDynamoDbContext, addDynamoDbContext, dynamoDbContextProviderToken, type DynamoDbModelBuilder, type IDynamoDbContextProvider } from "@abp/dynamodb";
import type { IUserRepository } from "../src/domain/index.js";
import { AbpUsersDynamoDbModule, DynamoDbUserRepositoryBase } from "../src/dynamodb/index.js";
import { FakeTable } from "../../../packages/dynamodb/test/fake-table.js";
import { TestUser } from "./test-user.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);
const dynamoDbClientMock = mockClient(DynamoDBClient);

class UsersDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder.entity(TestUser, (e) => {
      e.index(DynamoDbUserRepositoryBase.UserNameIndex, { pk: (u) => u.userName });
    });
  }
}

type ITestUserRepository = IUserRepository<TestUser>;
const ITestUserRepository = createToken<ITestUserRepository>("ITestUserRepository");

@Transient(ITestUserRepository)
class TestUserRepository extends DynamoDbUserRepositoryBase<UsersDbContext, TestUser> implements ITestUserRepository {
  static readonly inject = [dynamoDbContextProviderToken(UsersDbContext)] as const;
  constructor(dbContextProvider: IDynamoDbContextProvider<UsersDbContext>) {
    super(dbContextProvider, TestUser);
  }
}

@DependsOn(AbpUsersDynamoDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    addDynamoDbContext(this.context.services, UsersDbContext, (options) => {
      options.addRepository(TestUser, TestUserRepository);
    });
  }
}

let app: AbpApplication;
let provider: IServiceProvider;
let table: FakeTable;

beforeAll(async () => {
  app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values: { ConnectionStrings: { Default: "abp-table" } } }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  provider = app.serviceProvider;
});
afterAll(() => app.shutdown());

beforeEach(() => {
  table = new FakeTable();
  documentClientMock.reset();
  dynamoDbClientMock.reset();
  documentClientMock.on(GetCommand).callsFake((input) => table.get(input));
  documentClientMock.on(PutCommand).callsFake((input) => table.put(input));
  documentClientMock.on(DeleteCommand).callsFake((input) => table.delete(input));
  documentClientMock.on(UpdateCommand).callsFake((input) => table.update(input));
  documentClientMock.on(QueryCommand).callsFake((input) => table.query(input));
  documentClientMock.on(TransactWriteCommand).callsFake((input) => table.transactWrite(input));
  documentClientMock.on(BatchWriteCommand).callsFake((input) => table.batchWrite(input));
});

describe("DynamoDbUserRepositoryBase", () => {
  it("looks users up by user name through the configured gsi2 partition", async () => {
    const repository = provider.getRequired(ITestUserRepository);
    const alice = await repository.insert(new TestUser(undefined, "alice", "alice@abp.io"));
    await repository.insert(new TestUser(undefined, "bob"));
    expect(table.itemsOfType("TestUser").find((i) => i["userName"] === "alice")).toMatchObject({ gsi2pk: "host#TestUser#alice", gsi2sk: alice.id });
    documentClientMock.resetHistory();

    expect((await repository.findByUserName("alice"))?.id).toBe(alice.id);
    const query = documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(query).toMatchObject({ IndexName: "gsi2", ExpressionAttributeValues: { ":pk": "host#TestUser#alice" } });
    expect(await repository.findByUserName("zed")).toBeUndefined();
  });

  it("searches, pages and counts with the shared user filter", async () => {
    const repository = provider.getRequired(ITestUserRepository);
    await repository.insertMany([new TestUser(undefined, "carol", "carol@abp.io"), new TestUser(undefined, "alice", "alice@abp.io", "Alice"), new TestUser(undefined, "bob")]);

    expect((await repository.search()).map((u) => u.userName)).toEqual(["alice", "bob", "carol"]);
    expect((await repository.search("userName desc", 2, 1)).map((u) => u.userName)).toEqual(["bob", "alice"]);
    expect((await repository.search(undefined, undefined, undefined, "abp.io")).map((u) => u.userName)).toEqual(["alice", "carol"]);
    expect(await repository.getCount()).toBe(3);
    expect(await repository.getCount("Alice")).toBe(1);
    const ids = (await repository.search()).map((u) => u.id);
    expect((await repository.getListByIds(ids.slice(0, 2))).length).toBe(2);
  });
});
