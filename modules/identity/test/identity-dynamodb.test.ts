import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, Guid, NullLoggerFactory, type IServiceProvider } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IGuidGenerator } from "@abp/guids";
import { AbpPermissionManagementDynamoDbModule } from "@abp/permission-management/dynamodb";
import { Claim } from "@abp/security";
import {
  IIdentityClaimTypeRepository,
  IIdentityRoleRepository,
  IIdentitySessionRepository,
  IIdentityUserRepository,
  IOrganizationUnitRepository,
  IdentityClaimType,
  IdentityRole,
  IdentitySession,
  IdentityUser,
  IdentityUserClaim,
  OrganizationUnit,
} from "../src/domain/index.js";
import { AbpIdentityDynamoDbModule, DynamoDbIdentityUserRepository } from "../src/dynamodb/index.js";
import { FakeTable } from "../../../packages/dynamodb/test/fake-table.js";

const documentClientMock = mockClient(DynamoDBDocumentClient);
const dynamoDbClientMock = mockClient(DynamoDBClient);
const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

@DependsOn(AbpIdentityDynamoDbModule, AbpPermissionManagementDynamoDbModule)
class TestModule extends AbpModule {}

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

function user(userName: string, tenantId?: Guid): IdentityUser {
  const u = new IdentityUser(Guid.newGuid(), userName, `${userName}@abp.io`, tenantId);
  u.normalizedUserName = userName.toUpperCase();
  u.normalizedEmail = `${userName}@abp.io`.toUpperCase();
  return u;
}

describe("DynamoDbIdentityUserRepository", () => {
  it("stores users under AbpUsers with normalized user name (gsi2) and e-mail (gsi3) indexes and rehydrates sub-collections", async () => {
    const repository = provider.getRequired(IIdentityUserRepository);
    expect(repository).toBeInstanceOf(DynamoDbIdentityUserRepository);
    const john = user("john");
    john.addClaim(provider.getRequired(IGuidGenerator), new Claim("department", "R&D"));
    await repository.insert(john);
    expect(table.itemsOfType("AbpUsers").find((i) => i["id"] === john.id)).toMatchObject({ pk: `host#AbpUsers#${john.id}`, gsi2pk: "host#AbpUsers#JOHN", gsi3pk: "host#AbpUsers#JOHN@ABP.IO" });
    documentClientMock.resetHistory();

    const byName = await repository.findByNormalizedUserName("JOHN");
    expect(byName?.id).toBe(john.id);
    expect(byName).toBeInstanceOf(IdentityUser);
    expect(byName!.claims[0]).toBeInstanceOf(IdentityUserClaim);
    expect(byName!.findClaim(new Claim("department", "R&D"))).toBeDefined();
    expect(documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({ IndexName: "gsi2", ExpressionAttributeValues: { ":pk": "host#AbpUsers#JOHN" } });

    documentClientMock.resetHistory();
    expect((await repository.findByNormalizedEmail("JOHN@ABP.IO"))?.id).toBe(john.id);
    expect(documentClientMock.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({ IndexName: "gsi3", ExpressionAttributeValues: { ":pk": "host#AbpUsers#JOHN@ABP.IO" } });
    expect(await repository.findByNormalizedUserName("NOBODY")).toBeUndefined();
  });

  it("maintains the AbpUserLogins lookup items for findByLogin", async () => {
    const repository = provider.getRequired(IIdentityUserRepository);
    const jane = user("jane");
    jane.addLogin({ loginProvider: "Google", providerKey: "g-1", providerDisplayName: "Google" });
    await repository.insert(jane);
    expect(table.itemsOfType("AbpUserLogins")).toHaveLength(1);
    expect(table.itemsOfType("AbpUserLogins")[0]).toMatchObject({ pk: "host#AbpUserLogins#Google#g-1", userId: jane.id, gsi2pk: `host#AbpUserLogins#${jane.id}` });
    expect((await repository.findByLogin("Google", "g-1"))?.id).toBe(jane.id);
    expect(await repository.findByLogin("Google", "g-2")).toBeUndefined();

    const stored = (await repository.find(jane.id))!;
    stored.removeLogin("Google", "g-1");
    stored.addLogin({ loginProvider: "GitHub", providerKey: "gh-1", providerDisplayName: "GitHub" });
    await repository.update(stored);
    expect(table.itemsOfType("AbpUserLogins").map((i) => i["pk"])).toEqual(["host#AbpUserLogins#GitHub#gh-1"]);

    await repository.delete(stored);
    expect(table.itemsOfType("AbpUserLogins")).toHaveLength(0);
  });

  it("scopes users by tenant", async () => {
    const repository = provider.getRequired(IIdentityUserRepository);
    const currentTenant = provider.getRequired(ICurrentTenant);
    await currentTenant.run(tenantA, undefined, () => repository.insert(user("tenantuser", tenantA)));
    expect(table.itemsOfType("AbpUsers")[0]).toMatchObject({ pk: expect.stringMatching(new RegExp(`^${tenantA}#AbpUsers#`)) as string, gsi2pk: `${tenantA}#AbpUsers#TENANTUSER` });
    expect(await repository.findByNormalizedUserName("TENANTUSER")).toBeUndefined();
    expect((await currentTenant.run(tenantA, undefined, () => repository.findByNormalizedUserName("TENANTUSER")))?.tenantId).toBe(tenantA);
  });
});

describe("other identity DynamoDB repositories", () => {
  it("indexes roles by normalized name, claim types by name, organization units by parent/code and sessions by session id / user id", async () => {
    const roles = provider.getRequired(IIdentityRoleRepository);
    const role = new IdentityRole(Guid.newGuid(), "admin");
    role.normalizedName = "ADMIN";
    await roles.insert(role);
    expect(table.itemsOfType("AbpRoles")[0]).toMatchObject({ pk: `host#AbpRoles#${role.id}`, gsi2pk: "host#AbpRoles#ADMIN" });
    expect((await roles.findByNormalizedName("ADMIN"))?.id).toBe(role.id);
    expect((await roles.getListByNames(["admin", "nope"])).map((r) => r.id)).toEqual([role.id]);

    const claimTypes = provider.getRequired(IIdentityClaimTypeRepository);
    const claimType = await claimTypes.insert(new IdentityClaimType(Guid.newGuid(), "department"));
    expect(table.itemsOfType("AbpClaimTypes")[0]).toMatchObject({ pk: `host#AbpClaimTypes#${claimType.id}`, gsi2pk: "host#AbpClaimTypes#department" });
    expect(await claimTypes.anyByName("department")).toBe(true);
    expect(await claimTypes.anyByName("department", claimType.id)).toBe(false);

    const ous = provider.getRequired(IOrganizationUnitRepository);
    const root = new OrganizationUnit(Guid.newGuid(), "Root");
    root.code = "00001";
    const child = new OrganizationUnit(Guid.newGuid(), "Child", root.id);
    child.code = "00001.00001";
    await ous.insert(root);
    await ous.insert(child);
    expect(table.itemsOfType("AbpOrganizationUnits").find((i) => i["id"] === child.id)).toMatchObject({ gsi2pk: `host#AbpOrganizationUnits#${root.id}`, gsi2sk: "00001.00001" });
    expect(table.itemsOfType("AbpOrganizationUnits").find((i) => i["id"] === root.id)).toMatchObject({ gsi2pk: "host#AbpOrganizationUnits#root", gsi2sk: "00001" });
    expect((await ous.getChildren(root.id)).map((x) => x.id)).toEqual([child.id]);
    expect((await ous.getAllChildrenWithParentCode("00001", root.id)).map((x) => x.id)).toEqual([child.id]);

    const sessions = provider.getRequired(IIdentitySessionRepository);
    const session = new IdentitySession({ id: Guid.newGuid(), sessionId: "sess-1", device: "Web", userId: role.id, signedIn: new Date() });
    await sessions.insert(session);
    expect(table.itemsOfType("AbpSessions")[0]).toMatchObject({ gsi2pk: "host#AbpSessions#sess-1", gsi3pk: `host#AbpSessions#${role.id}` });
    expect((await sessions.findBySessionId("sess-1"))?.id).toBe(session.id);
    expect(await sessions.existsBySessionId("sess-2")).toBe(false);
  });
});
