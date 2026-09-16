import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Guid, IStringLocalizerFactory, NullLoggerFactory } from "@abp/core";
import { IDynamicPermissionDefinitionStore, IPermissionDefinitionManager, IPermissionStore, PermissionGrantResult, RolePermissionValueProvider, UserPermissionValueProvider } from "@abp/authorization";
import { AbpDistributedCacheOptions, IDistributedCacheStore } from "@abp/caching";
import { IDataSeeder } from "@abp/data";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { createAbpIntegratedTest } from "@abp/test-base";
import { IPermissionFinder, IsGrantedRequest } from "../src/domain-shared/index.js";
import {
  IDynamicPermissionDefinitionStoreInMemoryCache,
  IPermissionDefinitionRecordRepository,
  IPermissionGrantCache,
  IPermissionGrantRepository,
  IPermissionGroupDefinitionRecordRepository,
  IPermissionManager,
  PermissionDefinitionRecord,
  PermissionGrantCacheItem,
  PermissionManagementOptions,
  getAllForRole,
  getForClient,
  getForRole,
  setForClient,
  setForRole,
  setForUser,
} from "../src/domain/index.js";
import { PermissionManagementTestModule, TestPermissions, userRoleFinder } from "./test-module.js";

const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const test = createAbpIntegratedTest(PermissionManagementTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });

beforeAll(() => test.initialize());
afterAll(() => test.dispose());

function manager() {
  return test.getRequiredService(IPermissionManager);
}

describe("PermissionManager", () => {
  it("grants and revokes through the management provider of the provider name", async () => {
    await setForRole(manager(), "admin", TestPermissions.Users, true);
    const granted = await getForRole(manager(), "admin", TestPermissions.Users);
    expect(granted.isGranted).toBe(true);
    expect(granted.providers).toEqual([{ name: RolePermissionValueProvider.ProviderName, key: "admin" }]);

    await setForRole(manager(), "admin", TestPermissions.Users, false);
    expect((await getForRole(manager(), "admin", TestPermissions.Users)).isGranted).toBe(false);
    expect(await test.getRequiredService(IPermissionGrantRepository).getListByProvider("R", "admin")).toHaveLength(0);
  });

  it("reports role grants for users through the role finder", async () => {
    const userId = Guid.newGuid();
    userRoleFinder.roles.set(userId, ["editor"]);
    await setForRole(manager(), "editor", TestPermissions.UsersCreate, true);
    await setForUser(manager(), userId, TestPermissions.RoleOnly, true).catch(() => undefined);

    const forUser = await manager().get([TestPermissions.UsersCreate, TestPermissions.Users, "Test.Unknown"], UserPermissionValueProvider.ProviderName, userId);
    expect(forUser.result.map((x) => [x.name, x.isGranted])).toEqual([
      [TestPermissions.UsersCreate, true],
      [TestPermissions.Users, false],
      ["Test.Unknown", false],
    ]);
    expect(forUser.result[0]!.providers).toEqual([{ name: "R", key: "editor" }]);

    await setForUser(manager(), userId, TestPermissions.Users, true);
    const all = await manager().getAll(UserPermissionValueProvider.ProviderName, userId);
    expect(all.find((x) => x.name === TestPermissions.Users)).toMatchObject({ isGranted: true, providers: [{ name: "U", key: userId }] });
    expect(all.find((x) => x.name === TestPermissions.Disabled)).toMatchObject({ isGranted: false });
    expect(all.map((x) => x.name)).toContain(TestPermissions.HostOnly);
  });

  it("rejects incompatible grants and ignores undefined permissions", async () => {
    await expect(manager().set(TestPermissions.Disabled, "R", "admin", true)).rejects.toThrow(/is disabled/);
    await expect(manager().set(TestPermissions.RoleOnly, "U", Guid.newGuid(), true)).rejects.toThrow(/not compatible with the provider/);
    await expect(manager().set(TestPermissions.Users, "X", "key", true)).rejects.toThrow(/Unknown permission management provider/);
    await test.getRequiredService(ICurrentTenant).run(tenantA, undefined, async () => {
      await expect(manager().set(TestPermissions.HostOnly, "R", "admin", true)).rejects.toThrow(/multitenancy side/);
    });
    await manager().set("Test.Unknown", "R", "admin", true);
    expect((await manager().get("Test.Unknown", "R", "admin")).isGranted).toBe(false);
  });

  it("moves grants to a new provider key and deletes all grants of a key", async () => {
    await setForRole(manager(), "moderator", TestPermissions.Users, true);
    const grant = (await test.getRequiredService(IPermissionGrantRepository).findGrant(TestPermissions.Users, "R", "moderator"))!;
    await manager().updateProviderKey(grant, "supervisor");
    expect((await getForRole(manager(), "moderator", TestPermissions.Users)).isGranted).toBe(false);
    expect((await getForRole(manager(), "supervisor", TestPermissions.Users)).isGranted).toBe(true);

    await manager().delete("R", "supervisor");
    expect((await getAllForRole(manager(), "supervisor")).every((x) => !x.isGranted)).toBe(true);
  });

  it("keeps client grants on the host side", async () => {
    await test.getRequiredService(ICurrentTenant).run(tenantA, undefined, () => setForClient(manager(), "client-1", TestPermissions.Users, true));
    expect((await getForClient(manager(), "client-1", TestPermissions.Users)).isGranted).toBe(true);
    const grant = await test.getRequiredService(IPermissionGrantRepository).findGrant(TestPermissions.Users, "C", "client-1");
    expect(grant?.tenantId).toBeUndefined();
  });
});

describe("PermissionStore", () => {
  it("caches grants per provider key and invalidates the cache when a grant changes", async () => {
    const store = test.getRequiredService(IPermissionStore);
    const cache = test.getRequiredService(IPermissionGrantCache);
    const key = PermissionGrantCacheItem.calculateCacheKey(TestPermissions.UsersCreate, "R", "auditor");

    expect(await store.isGranted(TestPermissions.UsersCreate, "R", "auditor")).toBe(false);
    expect(await cache.get(key)).toMatchObject({ isGranted: false });
    expect(await cache.get(PermissionGrantCacheItem.calculateCacheKey(TestPermissions.Users, "R", "auditor"))).toMatchObject({ isGranted: false });

    await setForRole(manager(), "auditor", TestPermissions.UsersCreate, true);
    expect(await cache.get(key)).toBeUndefined();
    expect(await store.isGranted(TestPermissions.UsersCreate, "R", "auditor")).toBe(true);

    const many = await store.isGrantedMany([TestPermissions.UsersCreate, TestPermissions.Users, "Test.Unknown"], "R", "auditor");
    expect(many.result.get(TestPermissions.UsersCreate)).toBe(PermissionGrantResult.Granted);
    expect(many.result.get(TestPermissions.Users)).toBe(PermissionGrantResult.Undefined);
    expect(many.result.get("Test.Unknown")).toBe(PermissionGrantResult.Undefined);

    await setForRole(manager(), "auditor", TestPermissions.UsersCreate, false);
    expect(await store.isGranted(TestPermissions.UsersCreate, "R", "auditor")).toBe(false);
  });
});

describe("PermissionDataSeedContributor and PermissionFinder", () => {
  it("grants every role-compatible permission of the host side to the admin role", async () => {
    await test.getRequiredService(IDataSeeder).seed();
    const names = (await test.getRequiredService(IPermissionGrantRepository).getListByProvider("R", "admin")).map((g) => g.name).sort();
    expect(names).toEqual([TestPermissions.ManageRolePermissions, TestPermissions.ManageUserPermissions, TestPermissions.Disabled, TestPermissions.HostOnly, TestPermissions.RoleOnly, TestPermissions.Users, TestPermissions.UsersCreate].sort());
    await test.getRequiredService(IDataSeeder).seed();
    expect(await test.getRequiredService(IPermissionGrantRepository).getListByProvider("R", "admin")).toHaveLength(names.length);
  });

  it("answers user permission checks through the permission manager", async () => {
    const userId = Guid.newGuid();
    userRoleFinder.roles.set(userId, ["admin"]);
    const request = Object.assign(new IsGrantedRequest(), { userId, permissionNames: [TestPermissions.Users, TestPermissions.Disabled] });
    const [response] = await test.getRequiredService(IPermissionFinder).isGranted([request]);
    expect(response).toMatchObject({ userId, permissions: { [TestPermissions.Users]: true, [TestPermissions.Disabled]: false } });
  });
});

describe("StaticPermissionSaver and DynamicPermissionDefinitionStore", () => {
  it("saved the static definitions on startup", async () => {
    const groups = await test.getRequiredService(IPermissionGroupDefinitionRecordRepository).getList();
    expect(groups.map((g) => g.name)).toEqual([TestPermissions.GroupName]);
    expect(groups[0]!.displayName).toBe("L:AbpPermissionManagement,Permissions");

    const records = await test.getRequiredService(IPermissionDefinitionRecordRepository).getList();
    const create = records.find((r) => r.name === TestPermissions.UsersCreate)!;
    expect(create).toMatchObject({ groupName: TestPermissions.GroupName, parentName: TestPermissions.Users, isEnabled: true });
    expect(records.find((r) => r.name === TestPermissions.RoleOnly)?.providers).toBe("R");
    expect(records.find((r) => r.name === TestPermissions.Disabled)?.isEnabled).toBe(false);
    expect(await test.getRequiredService(IPermissionDefinitionRecordRepository).findByName(TestPermissions.HostOnly)).toBeDefined();
  });

  it("serves the saved definitions when the dynamic store is enabled and refreshes on stamp changes", async () => {
    const options = test.rootServiceProvider.getOptions(PermissionManagementOptions);
    expect(await test.getRequiredService(IDynamicPermissionDefinitionStore).getGroups()).toHaveLength(0);
    options.isDynamicPermissionStoreEnabled = true;
    try {
      const dynamicStore = test.getRequiredService(IDynamicPermissionDefinitionStore);
      const groups = await dynamicStore.getGroups();
      expect(groups.map((g) => g.name)).toEqual([TestPermissions.GroupName]);
      const create = await dynamicStore.getOrNull(TestPermissions.UsersCreate);
      expect(create?.parent?.name).toBe(TestPermissions.Users);
      expect((await dynamicStore.getOrNull(TestPermissions.RoleOnly))?.providers).toEqual(["R"]);
      expect((await dynamicStore.getPermissions()).map((p) => p.name)).toContain(TestPermissions.HostOnly);

      const record = new PermissionDefinitionRecord({ id: Guid.newGuid(), groupName: TestPermissions.GroupName, name: "Test.Dynamic", displayName: "F:Dynamic" });
      await test.getRequiredService(IPermissionDefinitionRecordRepository).insert(record);
      expect(await dynamicStore.getOrNull("Test.Dynamic")).toBeUndefined();

      const cacheOptions = test.rootServiceProvider.getOptions(AbpDistributedCacheOptions);
      await test.getRequiredService(IDistributedCacheStore).remove(`${cacheOptions.keyPrefix}_AbpInMemoryPermissionCacheStamp`);
      test.getRequiredService(IDynamicPermissionDefinitionStoreInMemoryCache).lastCheckTime = undefined;
      expect((await dynamicStore.getOrNull("Test.Dynamic"))?.displayName.localize(test.getRequiredService(IStringLocalizerFactory)).value).toBe("Dynamic");
      expect((await test.getRequiredService(IPermissionDefinitionManager).getOrNull("Test.Dynamic"))?.name).toBe("Test.Dynamic");
    } finally {
      options.isDynamicPermissionStoreEnabled = false;
    }
  });
});
