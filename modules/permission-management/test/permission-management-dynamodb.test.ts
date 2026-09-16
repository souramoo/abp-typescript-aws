import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Guid, NullLoggerFactory, type IServiceProvider } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IPermissionDefinitionRecordRepository, IPermissionGrantRepository, PermissionDefinitionRecord, PermissionGrant, PermissionManagementOptions } from "../src/domain/index.js";
import { AbpPermissionManagementDynamoDbModule, DynamoDbPermissionGrantRepository } from "../src/dynamodb/index.js";
import { FakeTable } from "../../../packages/dynamodb/test/fake-table.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);
const dynamoDbClientMock = mockClient(DynamoDBClient);
const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

@DependsOn(AbpPermissionManagementDynamoDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(PermissionManagementOptions, (options) => {
      options.saveStaticPermissionsToDatabase = false;
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

describe("DynamoDbPermissionGrantRepository", () => {
  it("stores grants under AbpPermissionGrants with a provider partition on gsi2 and queries it", async () => {
    const repository = provider.getRequired(IPermissionGrantRepository);
    expect(repository).toBeInstanceOf(DynamoDbPermissionGrantRepository);
    const grant = await repository.insert(new PermissionGrant(Guid.newGuid(), "Test.Users", "R", "admin"));
    await repository.insert(new PermissionGrant(Guid.newGuid(), "Test.Users.Create", "R", "admin"));
    await repository.insert(new PermissionGrant(Guid.newGuid(), "Test.Users", "R", "editor"));
    expect(table.itemsOfType("AbpPermissionGrants").find((i) => i["id"] === grant.id)).toMatchObject({ pk: `host#AbpPermissionGrants#${grant.id}`, gsi2pk: "host#AbpPermissionGrants#R#admin", gsi2sk: "Test.Users" });
    documentClientMock.resetHistory();

    expect((await repository.findGrant("Test.Users", "R", "admin"))?.id).toBe(grant.id);
    const query = documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(query).toMatchObject({ IndexName: "gsi2", KeyConditionExpression: "#pk = :pk AND #sk = :sk", ExpressionAttributeValues: { ":pk": "host#AbpPermissionGrants#R#admin", ":sk": "Test.Users" } });
    expect(await repository.findGrant("Test.Users", "R", "nobody")).toBeUndefined();
    expect((await repository.getListByProvider("R", "admin")).map((g) => g.name).sort()).toEqual(["Test.Users", "Test.Users.Create"]);
    expect((await repository.getListByNames(["Test.Users", "Other"], "R", "admin")).map((g) => g.name)).toEqual(["Test.Users"]);
  });

  it("scopes tenant grants by tenant and finds definition records by name", async () => {
    const repository = provider.getRequired(IPermissionGrantRepository);
    const currentTenant = provider.getRequired(ICurrentTenant);
    await currentTenant.run(tenantA, undefined, () => repository.insert(new PermissionGrant(Guid.newGuid(), "Test.Users", "R", "admin", tenantA)));
    expect(await repository.findGrant("Test.Users", "R", "admin")).toBeUndefined();
    expect((await currentTenant.run(tenantA, undefined, () => repository.findGrant("Test.Users", "R", "admin")))?.tenantId).toBe(tenantA);

    const definitions = provider.getRequired(IPermissionDefinitionRecordRepository);
    await definitions.insert(new PermissionDefinitionRecord({ id: Guid.newGuid(), groupName: "TestGroup", name: "Test.Users", displayName: "F:Users" }));
    expect((await definitions.findByName("Test.Users"))?.displayName).toBe("F:Users");
    expect(table.itemsOfType("AbpPermissions")[0]).toMatchObject({ gsi2pk: "host#AbpPermissions#Test.Users" });
  });
});
