import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessException, Guid, NullLoggerFactory } from "@abp/core";
import { IDataSeeder } from "@abp/data";
import { IPermissionGrantRepository, IPermissionManager } from "@abp/permission-management/domain";
import { AbpRoleConsts, Claim } from "@abp/security";
import { createAbpIntegratedTest } from "@abp/test-base";
import { IdentityErrorCodes, IdentityPermissions } from "../src/index.js";
import { IUserRoleFinder } from "../src/domain-shared/index.js";
import {
  IIdentityRoleRepository,
  IIdentityUserRepository,
  IdentityClaimType,
  IdentityClaimTypeManager,
  IdentityRole,
  IdentityRoleManager,
  IdentityUser,
  IdentityUserManager,
  OrganizationUnit,
  OrganizationUnitManager,
  SignInResult,
  UserLoginInfo,
} from "../src/domain/index.js";
import { IdentityTestModule } from "./identity-test-module.js";

const test = createAbpIntegratedTest(IdentityTestModule, { setAbpApplicationCreationOptions: (options) => void (options.loggerFactory = NullLoggerFactory.instance) });

beforeAll(async () => {
  await test.initialize();
  await test.getRequiredService(IDataSeeder).seed();
});
afterAll(() => test.dispose());

function newUser(userName: string, email = `${userName}@abp.io`): IdentityUser {
  return new IdentityUser(Guid.newGuid(), userName, email);
}

describe("IdentityDataSeeder", () => {
  it("creates the admin user, the static admin role and grants all identity permissions to it", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const admin = await userManager.findByName("admin");
    expect(admin).toBeDefined();
    expect(admin!.email).toBe("admin@abp.io");
    expect(await userManager.checkPassword(admin, "1q2w3E*")).toBe(true);
    expect(await userManager.getRoles(admin!)).toEqual([AbpRoleConsts.adminRoleName]);

    const adminRole = await test.getRequiredService(IdentityRoleManager).findByName("admin");
    expect(adminRole).toMatchObject({ isStatic: true, isPublic: true, normalizedName: "ADMIN" });

    const grants = await test.getRequiredService(IPermissionGrantRepository).getListByProvider("R", "admin");
    const names = grants.map((g) => g.name);
    for (const permission of IdentityPermissions.getAll().filter((p) => p !== IdentityPermissions.UserLookup.Default)) expect(names).toContain(permission);
    expect(names).not.toContain(IdentityPermissions.UserLookup.Default);
    expect(await test.getRequiredService(IUserRoleFinder).getRoleNames(admin!.id)).toEqual(["admin"]);
  });
});

describe("IdentityUserManager", () => {
  it("creates users with a hashed password, normalized names and unique user name / e-mail", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const john = newUser("john");
    (await userManager.create(john, "1q2w3E*")).checkErrors();
    expect(john.normalizedUserName).toBe("JOHN");
    expect(john.normalizedEmail).toBe("JOHN@ABP.IO");
    expect(john.passwordHash).toBeDefined();
    expect(john.passwordHash).not.toBe("1q2w3E*");
    expect(await userManager.checkPassword(john, "1q2w3E*")).toBe(true);
    expect(await userManager.checkPassword(john, "wrong")).toBe(false);

    const duplicateName = await userManager.create(newUser("John", "other@abp.io"), "1q2w3E*");
    expect(duplicateName.succeeded).toBe(false);
    expect(duplicateName.errors.map((e) => e.code)).toContain("DuplicateUserName");

    const duplicateEmail = await userManager.create(newUser("john2", "john@abp.io"), "1q2w3E*");
    expect(duplicateEmail.succeeded).toBe(false);
    expect(duplicateEmail.errors.map((e) => e.code)).toContain("DuplicateEmail");

    expect(() => duplicateEmail.checkErrors()).toThrow(BusinessException);
  });

  it("enforces the password policy", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const result = await userManager.create(newUser("weak"), "abc");
    expect(result.succeeded).toBe(false);
    expect(result.errors.map((e) => e.code).sort()).toEqual(["PasswordRequiresDigit", "PasswordRequiresNonAlphanumeric", "PasswordRequiresUpper", "PasswordTooShort"]);
    expect(await userManager.findByName("weak")).toBeUndefined();
  });

  it("changes and resets passwords with the token provider", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const user = newUser("pwd");
    (await userManager.create(user, "1q2w3E*")).checkErrors();

    await expect(userManager.changePassword(user, "wrong", "2w3e4R*")).rejects.toMatchObject({ identityResult: { errors: [{ code: "PasswordMismatch" }] } });
    (await userManager.changePassword(user, "1q2w3E*", "2w3e4R*")).checkErrors();
    expect(await userManager.checkPassword(user, "2w3e4R*")).toBe(true);

    const token = await userManager.generatePasswordResetToken(user);
    expect((await userManager.resetPassword(user, "bogus", "3e4r5T*")).errors.map((e) => e.code)).toEqual(["InvalidToken"]);
    (await userManager.resetPassword(user, token, "3e4r5T*")).checkErrors();
    expect(await userManager.checkPassword(user, "3e4r5T*")).toBe(true);
    expect((await userManager.resetPassword(user, token, "4r5t6Y*")).succeeded).toBe(false);
  });

  it("locks the user out after the configured failed attempts", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const user = newUser("locky");
    (await userManager.create(user, "1q2w3E*")).checkErrors();
    for (let i = 0; i < 4; i++) expect(await userManager.checkPasswordSignIn(user, "wrong", true)).toBe(SignInResult.Failed);
    expect(await userManager.checkPasswordSignIn(user, "wrong", true)).toBe(SignInResult.LockedOut);
    expect(await userManager.isLockedOut(user)).toBe(true);
    expect(await userManager.checkPasswordSignIn(user, "1q2w3E*", true)).toBe(SignInResult.LockedOut);

    (await userManager.setLockoutEndDate(user, undefined)).checkErrors();
    expect(await userManager.checkPasswordSignIn(user, "1q2w3E*", true)).toBe(SignInResult.Success);
    expect(user.accessFailedCount).toBe(0);

    user.setIsActive(false);
    (await userManager.update(user)).checkErrors();
    expect(await userManager.checkPasswordSignIn(user, "1q2w3E*", true)).toBe(SignInResult.NotAllowed);
  });

  it("manages roles, claims, logins and organization units", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const roleManager = test.getRequiredService(IdentityRoleManager);
    const user = newUser("member");
    (await userManager.create(user, "1q2w3E*")).checkErrors();
    (await roleManager.create(new IdentityRole(Guid.newGuid(), "editor"))).checkErrors();

    (await userManager.addToRole(user, "editor")).checkErrors();
    expect(await userManager.getRoles(user)).toEqual(["editor"]);
    expect(await userManager.isInRole(user, "editor")).toBe(true);
    expect((await userManager.addToRole(user, "editor")).errors.map((e) => e.code)).toEqual(["UserAlreadyInRole"]);
    expect((await userManager.addToRole(user, "nope")).errors.map((e) => e.code)).toEqual(["RoleNotFound"]);
    expect(await test.getRequiredService(IIdentityUserRepository).getUserIdListByRoleId((await roleManager.findByName("editor"))!.id)).toEqual([user.id]);
    (await userManager.setRoles(user, [])).checkErrors();
    expect(await userManager.getRoles(user)).toEqual([]);

    (await userManager.addClaim(user, new Claim("department", "R&D"))).checkErrors();
    expect((await userManager.getClaims(user)).map((c) => [c.type, c.value])).toEqual([["department", "R&D"]]);
    expect((await test.getRequiredService(IIdentityUserRepository).getListByClaim(new Claim("department", "R&D"))).map((u) => u.id)).toEqual([user.id]);

    (await userManager.addLogin(user, new UserLoginInfo("Google", "g-123", "Google"))).checkErrors();
    expect((await userManager.findByLogin("Google", "g-123"))?.id).toBe(user.id);
    expect(await userManager.findByLogin("Google", "g-999")).toBeUndefined();

    const ou = new OrganizationUnit(Guid.newGuid(), "R&D");
    await test.withUnitOfWork(() => test.getRequiredService(OrganizationUnitManager).create(ou));
    await userManager.addToOrganizationUnit(user, ou);
    expect((await userManager.getOrganizationUnits(user)).map((x) => x.id)).toEqual([ou.id]);
  });

  it("changes user name and e-mail through the validators", async () => {
    const userManager = test.getRequiredService(IdentityUserManager);
    const user = newUser("renamer");
    (await userManager.create(user, "1q2w3E*")).checkErrors();
    (await userManager.setUserName(user, "renamed")).checkErrors();
    (await userManager.setEmail(user, "renamed@abp.io")).checkErrors();
    expect((await userManager.findByName("renamed"))?.id).toBe(user.id);
    expect((await userManager.findByEmail("RENAMED@abp.io"))?.id).toBe(user.id);
    expect(user.emailConfirmed).toBe(false);
    await expect(userManager.setUserName(user, "admin")).rejects.toMatchObject({ identityResult: { errors: [{ code: "DuplicateUserName" }] } });
    await expect(userManager.setUserName(user, "bad name!")).rejects.toMatchObject({ identityResult: { errors: [{ code: "InvalidUserName" }] } });
    const stored = await userManager.getById(user.id);
    expect(stored.userName).toBe("renamed");
    await expect(userManager.setEmail(stored, "admin@abp.io")).rejects.toMatchObject({ identityResult: { errors: [{ code: "DuplicateEmail" }] } });
  });
});

describe("IdentityRoleManager", () => {
  it("protects static roles from deletion and renaming", async () => {
    const roleManager = test.getRequiredService(IdentityRoleManager);
    const admin = (await roleManager.findByName("admin"))!;
    await expect(roleManager.delete(admin)).rejects.toMatchObject({ code: IdentityErrorCodes.StaticRoleDeletion });
    await expect(roleManager.setRoleName(admin, "root")).rejects.toMatchObject({ code: IdentityErrorCodes.StaticRoleRenaming });
    expect((await roleManager.create(new IdentityRole(Guid.newGuid(), "Admin"))).errors.map((e) => e.code)).toEqual(["DuplicateRoleName"]);
  });

  it("moves the permission grants to the new name when a role is renamed", async () => {
    const roleManager = test.getRequiredService(IdentityRoleManager);
    const permissionManager = test.getRequiredService(IPermissionManager);
    const role = new IdentityRole(Guid.newGuid(), "moderator");
    (await roleManager.create(role)).checkErrors();
    await permissionManager.set(IdentityPermissions.Users.Default, "R", "moderator", true);

    await test.withUnitOfWork(async (provider) => {
      const manager = provider.getRequired(IdentityRoleManager);
      const tracked = await manager.getById(role.id);
      (await manager.setRoleName(tracked, "supervisor")).checkErrors();
      (await manager.update(tracked)).checkErrors();
    });

    const grants = test.getRequiredService(IPermissionGrantRepository);
    expect((await grants.getListByProvider("R", "moderator")).map((g) => g.name)).toEqual([]);
    expect((await grants.getListByProvider("R", "supervisor")).map((g) => g.name)).toEqual([IdentityPermissions.Users.Default]);
    expect((await test.getRequiredService(IIdentityRoleRepository).findByNormalizedName("SUPERVISOR"))?.id).toBe(role.id);
  });

  it("deletes the grants of a deleted role", async () => {
    const permissionManager = test.getRequiredService(IPermissionManager);
    const role = new IdentityRole(Guid.newGuid(), "temp");
    (await test.getRequiredService(IdentityRoleManager).create(role)).checkErrors();
    await permissionManager.set(IdentityPermissions.Roles.Default, "R", "temp", true);
    await test.withUnitOfWork(async (provider) => {
      const manager = provider.getRequired(IdentityRoleManager);
      (await manager.delete(await manager.getById(role.id))).checkErrors();
    });
    expect(await test.getRequiredService(IPermissionGrantRepository).getListByProvider("R", "temp")).toEqual([]);
  });
});

describe("OrganizationUnitManager", () => {
  it("assigns hierarchical codes and moves units", async () => {
    const manager = test.getRequiredService(OrganizationUnitManager);
    const root = new OrganizationUnit(Guid.newGuid(), "Root");
    const child1 = new OrganizationUnit(Guid.newGuid(), "Child 1", root.id);
    const child2 = new OrganizationUnit(Guid.newGuid(), "Child 2", root.id);
    const grandChild = new OrganizationUnit(Guid.newGuid(), "Grand child", child1.id);
    await test.withUnitOfWork(async (provider) => {
      const m = provider.getRequired(OrganizationUnitManager);
      await m.create(root);
      await m.create(child1);
      await m.create(child2);
      await m.create(grandChild);
    });
    const rootCode = root.code;
    expect(child1.code).toBe(`${rootCode}.00001`);
    expect(child2.code).toBe(`${rootCode}.00002`);
    expect(grandChild.code).toBe(`${rootCode}.00001.00001`);
    expect((await manager.findChildren(root.id, true)).map((x) => x.displayName).sort()).toEqual(["Child 1", "Child 2", "Grand child"]);

    await test.withUnitOfWork((provider) => provider.getRequired(OrganizationUnitManager).move(grandChild.id, child2.id));
    const moved = await manager.getCodeOrDefault(grandChild.id);
    expect(moved).toBe(`${rootCode}.00002.00001`);

    await expect(test.withUnitOfWork((provider) => provider.getRequired(OrganizationUnitManager).create(new OrganizationUnit(Guid.newGuid(), "Child 1", root.id)))).rejects.toMatchObject({ code: IdentityErrorCodes.DuplicateOrganizationUnitDisplayName });
  });
});

describe("IdentityClaimTypeManager", () => {
  it("rejects duplicate claim type names and static claim type changes", async () => {
    const manager = test.getRequiredService(IdentityClaimTypeManager);
    const claimType = await manager.create(new IdentityClaimType(Guid.newGuid(), "department"));
    expect(claimType.name).toBe("department");
    await expect(manager.create(new IdentityClaimType(Guid.newGuid(), "department"))).rejects.toMatchObject({ code: IdentityErrorCodes.ClaimNameExist });
    const isStatic = await manager.create(new IdentityClaimType(Guid.newGuid(), "fixed", { isStatic: true }));
    await expect(manager.update(isStatic)).rejects.toMatchObject({ code: IdentityErrorCodes.CanNotUpdateStaticClaimType });
    await expect(manager.delete(isStatic.id)).rejects.toMatchObject({ code: IdentityErrorCodes.CanNotDeleteStaticClaimType });
  });
});
