import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, Guid, Transient, createToken, type ServiceCollection, NullLoggerFactory } from "@abp/core";
import { EntityNotFoundException } from "@abp/ddd-domain";
import { MemoryDbContext, addMemoryDbContext, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import { createAbpIntegratedTest } from "@abp/test-base";
import { IUnitOfWorkManager } from "@abp/uow";
import { IExternalUserLookupServiceProvider, UserData, toAbpUserData, type IUserData, type IUserRepository } from "../src/index.js";
import { AbpUsersMemoryDbModule, MemoryDbUserRepositoryBase } from "../src/memory-db/index.js";
import { UserLookupService, getUserById, getUserByUserName, userLookupServiceToken } from "../src/domain/index.js";
import { TestUser } from "./test-user.js";

class UsersTestDbContext extends MemoryDbContext {
  override readonly entities = [TestUser];
}

type ITestUserRepository = IUserRepository<TestUser>;
const ITestUserRepository = createToken<ITestUserRepository>("ITestUserRepository");

@Transient(ITestUserRepository)
class TestUserRepository extends MemoryDbUserRepositoryBase<UsersTestDbContext, TestUser> implements ITestUserRepository {
  static readonly inject = [memoryDatabaseProviderToken(UsersTestDbContext)] as const;
  constructor(databaseProvider: IMemoryDatabaseProvider<UsersTestDbContext>) {
    super(databaseProvider, TestUser);
  }
}

const ITestUserLookupService = userLookupServiceToken(TestUser);

@Transient(ITestUserLookupService)
class TestUserLookupService extends UserLookupService<TestUser, ITestUserRepository> {
  static override readonly inject = [ITestUserRepository, IUnitOfWorkManager] as const;
  constructor(userRepository: ITestUserRepository, unitOfWorkManager: IUnitOfWorkManager) {
    super(userRepository, unitOfWorkManager);
  }
  protected createUser(externalUser: IUserData): TestUser {
    return TestUser.fromUserData(externalUser);
  }
}

/** Same service, but always consults the external provider (`SkipExternalLookupIfLocalUserExists = false`). */
@Transient()
class SyncingUserLookupService extends TestUserLookupService {
  constructor(userRepository: ITestUserRepository, unitOfWorkManager: IUnitOfWorkManager) {
    super(userRepository, unitOfWorkManager);
    this.skipExternalLookupIfLocalUserExists = false;
  }
}

class FakeExternalUserLookupServiceProvider {
  readonly users = new Map<string, UserData>();
  calls = 0;
  fail = false;

  async findById(id: Guid): Promise<IUserData | undefined> {
    this.touch();
    return [...this.users.values()].find((u) => u.id === id);
  }
  async findByUserName(userName: string): Promise<IUserData | undefined> {
    this.touch();
    return this.users.get(userName);
  }
  async search(): Promise<IUserData[]> {
    this.touch();
    return [...this.users.values()];
  }
  async getCount(): Promise<number> {
    this.touch();
    return this.users.size;
  }
  private touch(): void {
    this.calls++;
    if (this.fail) throw new Error("external system is down");
  }
}

@DependsOn(AbpUsersMemoryDbModule)
class UsersTestModule extends AbpModule {
  override configureServices(): void {
    addMemoryDbContext(this.context.services, UsersTestDbContext, (options) => {
      options.addRepository(TestUser, TestUserRepository);
    });
  }
}

const external = new FakeExternalUserLookupServiceProvider();
const test = createAbpIntegratedTest(UsersTestModule, {
  setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance),
  afterAddApplication: (services: ServiceCollection) => {
    services.addSingleton(IExternalUserLookupServiceProvider, { useValue: external });
  },
});

beforeAll(() => test.initialize());
afterAll(() => test.dispose());

function repository(): ITestUserRepository {
  return test.getRequiredService(ITestUserRepository);
}

function localOnlyLookup(): TestUserLookupService {
  const service = test.getRequiredService(TestUserLookupService);
  service.externalUserLookupServiceProvider = undefined;
  return service;
}

describe("MemoryDbUserRepositoryBase", () => {
  it("finds by user name, searches with filter/sorting/paging and counts", async () => {
    const repo = repository();
    await repo.insertMany([new TestUser(undefined, "alice", "alice@abp.io", "Alice"), new TestUser(undefined, "bob", "bob@abp.io", "Bob"), new TestUser(undefined, "carol", "carol@abp.io", "Carol", "Anders")]);

    expect((await repo.findByUserName("bob"))?.email).toBe("bob@abp.io");
    expect(await repo.findByUserName("nobody")).toBeUndefined();

    expect((await repo.search()).map((u) => u.userName)).toEqual(["alice", "bob", "carol"]);
    expect((await repo.search("userName desc")).map((u) => u.userName)).toEqual(["carol", "bob", "alice"]);
    expect((await repo.search(undefined, 1, 1)).map((u) => u.userName)).toEqual(["bob"]);
    expect((await repo.search(undefined, undefined, undefined, "Anders")).map((u) => u.userName)).toEqual(["carol"]);
    expect((await repo.search(undefined, undefined, undefined, "abp.io")).map((u) => u.userName)).toEqual(["alice", "bob", "carol"]);

    expect(await repo.getCount()).toBe(3);
    expect(await repo.getCount("ali")).toBe(1);

    const [alice, carol] = await Promise.all([repo.findByUserName("alice"), repo.findByUserName("carol")]);
    expect((await repo.getListByIds([alice!.id, carol!.id])).map((u) => u.userName).sort()).toEqual(["alice", "carol"]);
  });
});

describe("UserLookupService without an external provider", () => {
  it("returns local users and maps searches to IUserData", async () => {
    const lookup = localOnlyLookup();
    const alice = (await repository().findByUserName("alice"))!;

    expect((await lookup.findById(alice.id))?.userName).toBe("alice");
    expect((await lookup.findByUserName("carol"))?.userName).toBe("carol");
    expect(await lookup.findByUserName("nobody")).toBeUndefined();
    expect(await lookup.getCount("bob")).toBe(1);
    const found = await lookup.search("userName desc", "abp.io");
    expect(found.map((u) => u.userName)).toEqual(["carol", "bob", "alice"]);
    expect(found[0]).toBeInstanceOf(UserData);
    expect(found[2]).toEqual(toAbpUserData((await repository().findByUserName("alice"))!));

    expect(await getUserById(lookup, TestUser, alice.id)).toMatchObject({ userName: "alice" });
    await expect(getUserByUserName(lookup, TestUser, "nobody")).rejects.toBeInstanceOf(EntityNotFoundException);
  });
});

describe("UserLookupService with an external provider", () => {
  it("skips the external lookup when the local user exists", async () => {
    const lookup = test.getRequiredService(TestUserLookupService);
    external.calls = 0;
    expect((await lookup.findByUserName("alice"))?.userName).toBe("alice");
    expect(external.calls).toBe(0);
  });

  it("creates the local user from the external one in a separate unit of work", async () => {
    const lookup = test.getRequiredService(TestUserLookupService);
    const daveId = Guid.newGuid();
    external.users.set("dave", new UserData({ id: daveId, userName: "dave", email: "dave@abp.io", name: "Dave" }));

    const dave = await lookup.findByUserName("dave");
    expect(dave).toBeInstanceOf(TestUser);
    expect(dave).toMatchObject({ id: daveId, userName: "dave", email: "dave@abp.io" });
    expect((await repository().find(daveId))?.userName).toBe("dave");
    expect((await lookup.findById(daveId))?.userName).toBe("dave");
  });

  it("deletes the local user when the external system no longer knows it", async () => {
    const lookup = test.getRequiredService(SyncingUserLookupService);
    const erin = await repository().insert(new TestUser(undefined, "erin"));
    expect(await lookup.findById(erin.id)).toBeUndefined();
    expect(await repository().find(erin.id)).toBeUndefined();
  });

  it("updates the local user when the external data changed", async () => {
    const lookup = test.getRequiredService(SyncingUserLookupService);
    const frank = await repository().insert(new TestUser(undefined, "frank", "frank@abp.io", "Frank"));
    external.users.set("frank", new UserData({ id: frank.id, userName: "frank", email: "frank@new.io", name: "Franklin" }));

    const updated = await lookup.findByUserName("frank");
    expect(updated).toMatchObject({ id: frank.id, email: "frank@new.io", name: "Franklin" });
    expect((await repository().get(frank.id)).name).toBe("Franklin");

    external.calls = 0;
    expect(await lookup.findByUserName("frank")).toMatchObject({ name: "Franklin" });
    expect(external.calls).toBe(1);
  });

  it("falls back to the local user when the external provider fails", async () => {
    const lookup = test.getRequiredService(SyncingUserLookupService);
    external.fail = true;
    try {
      expect((await lookup.findByUserName("frank"))?.userName).toBe("frank");
      expect(await lookup.findByUserName("ghost")).toBeUndefined();
    } finally {
      external.fail = false;
    }
  });

  it("delegates search and count to the external provider", async () => {
    const lookup = test.getRequiredService(TestUserLookupService);
    expect(await lookup.getCount()).toBe(external.users.size);
    expect((await lookup.search()).map((u) => u.userName).sort()).toEqual([...external.users.keys()].sort());
  });
});
