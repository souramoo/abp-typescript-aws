import { AbpApplication, AbpModule, DependsOn, Transient, hasErrorCode, type IKeyedObject } from "@abp/core";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor } from "@abp/security";
import { describe, expect, it } from "vitest";
import {
  AbpAuthorizationErrorCodes,
  AbpAuthorizationException,
  AbpAuthorizationModule,
  AbpAuthorizationOptions,
  AbpPermissionOptions,
  AllowAnonymous,
  Authorize,
  AuthorizeMetadata,
  IAbpAuthorizationPolicyProvider,
  IAbpAuthorizationService,
  IPermissionChecker,
  IPermissionDefinitionManager,
  IPermissionStore,
  IResourcePermissionChecker,
  IResourcePermissionStore,
  MultiplePermissionGrantResult,
  NullPermissionStore,
  PermissionDefinitionContext,
  PermissionDefinitionProvider,
  PermissionGrantResult,
  PermissionsRequirement,
  ResourcePermissionCheckerExtensions,
  ResourcePermissionPopulator,
  RolePermissionValueProvider,
  addAlwaysAllowAuthorization,
  requireAuthenticated,
  requirePermissions,
  tryDisablePermission,
  type IHasResourcePermissions,
  type IPermissionDefinitionContext,
} from "../src/index.js";

const userId = "44444444-4444-4444-8444-444444444444";
const tenantId = "11111111-1111-4111-8111-111111111111";

class FakePermissionStore implements IPermissionStore {
  readonly grants = new Set<string>();
  grant(name: string, providerName: string, providerKey: string): this {
    this.grants.add(`${name}|${providerName}|${providerKey}`);
    return this;
  }
  async isGranted(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<boolean> {
    return this.grants.has(`${name}|${providerName}|${providerKey}`);
  }
  async isGrantedMany(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<MultiplePermissionGrantResult> {
    const result = new MultiplePermissionGrantResult(names);
    for (const name of names) if (await this.isGranted(name, providerName, providerKey)) result.result.set(name, PermissionGrantResult.Granted);
    return result;
  }
}

class FakeResourcePermissionStore implements IResourcePermissionStore {
  readonly grants = new Set<string>();
  grant(name: string, resourceName: string, resourceKey: string, providerName: string, providerKey: string): this {
    this.grants.add([name, resourceName, resourceKey, providerName, providerKey].join("|"));
    return this;
  }
  async isGranted(name: string, resourceName: string, resourceKey: string, providerName: string, providerKey: string): Promise<boolean> {
    return this.grants.has([name, resourceName, resourceKey, providerName, providerKey].join("|"));
  }
  async isGrantedMany(names: readonly string[], resourceName: string, resourceKey: string, providerName: string, providerKey: string): Promise<MultiplePermissionGrantResult> {
    const result = new MultiplePermissionGrantResult(names);
    for (const name of names) if (await this.isGranted(name, resourceName, resourceKey, providerName, providerKey)) result.result.set(name, PermissionGrantResult.Granted);
    return result;
  }
  async getPermissions(): Promise<MultiplePermissionGrantResult> {
    return new MultiplePermissionGrantResult();
  }
  async getGrantedPermissions(): Promise<string[]> {
    return [];
  }
  async getGrantedResourceKeys(): Promise<string[]> {
    return [];
  }
}

@Transient()
class BookPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const group = context.addGroup("Books");
    const books = group.addPermission("Books");
    books.addChild("Books.Create");
    books.addChild("Books.Delete");
    group.addPermission("Books.TenantOnly", undefined, MultiTenancySides.Tenant);
    group.addPermission("Books.HostOnly", undefined, MultiTenancySides.Host);
    group.addPermission("Books.Disabled", undefined, MultiTenancySides.Both, false);
    requireAuthenticated(group.addPermission("Books.Authenticated"));
    requirePermissions(group.addPermission("Books.NeedsCreate"), ["Books.Create"]);
    group.addPermission("Books.RoleOnly").withProviders(RolePermissionValueProvider.ProviderName);
    context.addResourcePermission("Edit", "Document", "Documents.Manage");
  }
}

@Transient()
class DisablingPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(): void {}
  override postDefine(context: IPermissionDefinitionContext): void {
    expect(tryDisablePermission(context, "Books.Delete")).toBe(true);
    expect(tryDisablePermission(context, "Nope")).toBe(false);
  }
}

class Document implements IKeyedObject, IHasResourcePermissions {
  resourcePermissions: Map<string, boolean> | undefined;
  constructor(readonly key: string) {}
}

@Transient()
class BookAppService {
  @Authorize("Books.Create")
  async create(): Promise<string> {
    return "created";
  }

  @Authorize()
  async list(): Promise<string> {
    return "listed";
  }

  @AllowAnonymous()
  async publicInfo(): Promise<string> {
    return "public";
  }

  async unprotected(): Promise<string> {
    return "unprotected";
  }

  @Authorize({ roles: ["editor"] })
  async edit(): Promise<string> {
    return "edited";
  }

  @Authorize("Missing.Policy")
  async broken(): Promise<string> {
    return "broken";
  }
}

@Transient()
@Authorize("Books.Delete")
class AdminAppService {
  async purge(): Promise<string> {
    return "purged";
  }

  @Authorize("Books.Create")
  async createToo(): Promise<string> {
    return "created";
  }
}

@DependsOn(AbpAuthorizationModule)
class TestModule extends AbpModule {
  static readonly permissionStore = new FakePermissionStore();
  static readonly resourcePermissionStore = new FakeResourcePermissionStore();

  override configureServices(): void {
    this.context.services.replaceSingleton(IPermissionStore, { useValue: TestModule.permissionStore });
    this.context.services.replaceSingleton(IResourcePermissionStore, { useValue: TestModule.resourcePermissionStore });
    this.configure(AbpAuthorizationOptions, (options) => {
      options.addPolicy("HasSecretClaim", (context) => context.user.hasClaim("secret", "yes"));
    });
  }
}

function principal(...claims: Claim[]): ClaimsPrincipal {
  return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
}
const anonymous = new ClaimsPrincipal(new ClaimsIdentity());
const adminUser = principal(new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.role, "admin"));
const tenantUser = principal(new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.tenantId, tenantId), new Claim(AbpClaimTypes.role, "admin"));
const editorUser = principal(new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.role, "editor"), new Claim("secret", "yes"));

TestModule.permissionStore.grant("Books.Create", "R", "admin").grant("Books.TenantOnly", "R", "admin").grant("Books.HostOnly", "R", "admin").grant("Books.Disabled", "R", "admin").grant("Books.Authenticated", "U", userId).grant("Books.RoleOnly", "U", userId);
TestModule.resourcePermissionStore.grant("Edit", "Document", "42", "U", userId);

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
  await app.initialize();
  return app;
}

describe("permission definitions", () => {
  it("collects groups, permissions and children from auto-registered providers", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getOptions(AbpPermissionOptions).definitionProviders.toArray()).toEqual(expect.arrayContaining([BookPermissionDefinitionProvider, DisablingPermissionDefinitionProvider]));

    const manager = app.serviceProvider.getRequired(IPermissionDefinitionManager);
    const groups = await manager.getGroups();
    expect(groups.map((g) => g.name)).toEqual(["Books"]);
    expect(groups[0]!.properties.get(PermissionDefinitionContext.KnownPropertyNames.CurrentProviderName)).toBe("BookPermissionDefinitionProvider");

    const books = await manager.get("Books");
    expect(books.children.map((c) => c.name)).toEqual(["Books.Create", "Books.Delete"]);
    expect((await manager.get("Books.Create")).parent).toBe(books);
    expect((await manager.get("Books.Delete")).isEnabled).toBe(false);
    expect((await manager.getOrNull("Nope"))).toBeUndefined();
    await expect(manager.get("Nope")).rejects.toThrow("Undefined permission: Nope");
    expect((await manager.getPermissions()).map((p) => p.name)).toContain("Books.Delete");
    expect(groups[0]!.getPermissionsWithChildren().map((p) => p.name).slice(0, 3)).toEqual(["Books", "Books.Create", "Books.Delete"]);

    const edit = await manager.getResourcePermission("Document", "Edit");
    expect(edit.managementPermissionName).toBe("Documents.Manage");
    expect(() => edit.addChild("x")).toThrow(/Resource permission cannot have child permissions/);
    await app.shutdown();
  });
});

describe("PermissionChecker", () => {
  it("grants through the role value provider using the permission store", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IPermissionChecker);
    expect(await checker.isGranted(adminUser, "Books.Create")).toBe(true);
    expect(await checker.isGranted(adminUser, "Books")).toBe(false);
    expect(await checker.isGranted(anonymous, "Books.Create")).toBe(false);
    expect(await checker.isGranted(adminUser, "Undefined.Permission")).toBe(false);

    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    expect(await accessor.run(adminUser, () => checker.isGranted("Books.Create"))).toBe(true);
    expect(await checker.isGranted("Books.Create")).toBe(false);

    const many = await checker.isGranted(adminUser, ["Books.Create", "Books", "Unknown"]);
    expect(many.result.get("Books.Create")).toBe(PermissionGrantResult.Granted);
    expect(many.result.get("Books")).toBe(PermissionGrantResult.Undefined);
    expect(many.result.get("Unknown")).toBe(PermissionGrantResult.Prohibited);
    expect(many.allGranted).toBe(false);
    expect((await checker.isGranted(adminUser, ["Books.Create"])).allGranted).toBe(true);
    await app.shutdown();
  });

  it("filters by multi-tenancy side of the principal or the current tenant", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IPermissionChecker);
    expect(await checker.isGranted(adminUser, "Books.TenantOnly")).toBe(false);
    expect(await checker.isGranted(adminUser, "Books.HostOnly")).toBe(true);
    expect(await checker.isGranted(tenantUser, "Books.TenantOnly")).toBe(true);
    expect(await checker.isGranted(tenantUser, "Books.HostOnly")).toBe(false);
    const many = await checker.isGranted(tenantUser, ["Books.TenantOnly", "Books.HostOnly"]);
    expect(many.result.get("Books.TenantOnly")).toBe(PermissionGrantResult.Granted);
    expect(many.result.get("Books.HostOnly")).toBe(PermissionGrantResult.Undefined);
    await app.shutdown();
  });

  it("never grants a disabled permission and honours the providers filter", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IPermissionChecker);
    expect(await checker.isGranted(adminUser, "Books.Disabled")).toBe(false);
    expect((await checker.isGranted(adminUser, ["Books.Disabled"])).result.get("Books.Disabled")).toBe(PermissionGrantResult.Undefined);
    expect(await checker.isGranted(adminUser, "Books.RoleOnly")).toBe(false);
    await app.shutdown();
  });

  it("runs simple state checkers: requireAuthenticated and requirePermissions", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IPermissionChecker);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    expect(await checker.isGranted(adminUser, "Books.Authenticated")).toBe(false);
    expect(await accessor.run(adminUser, () => checker.isGranted("Books.Authenticated"))).toBe(true);
    expect(await accessor.run(adminUser, () => checker.isGranted("Books.NeedsCreate"))).toBe(false);
    TestModule.permissionStore.grant("Books.NeedsCreate", "U", userId);
    expect(await accessor.run(adminUser, () => checker.isGranted("Books.NeedsCreate"))).toBe(true);
    expect(await accessor.run(editorUser, () => checker.isGranted("Books.NeedsCreate"))).toBe(false);
    const many = await accessor.run(adminUser, () => checker.isGranted(["Books.NeedsCreate", "Books.Authenticated"]));
    expect(many.allGranted).toBe(true);
    await app.shutdown();
  });
});

describe("resource permissions", () => {
  it("checks a permission for a keyed resource and populates IHasResourcePermissions", async () => {
    const app = await createApp();
    const checker = app.serviceProvider.getRequired(IResourcePermissionChecker);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    expect(await checker.isGranted(adminUser, "Edit", "Document", "42")).toBe(true);
    expect(await checker.isGranted(adminUser, "Edit", "Document", "43")).toBe(false);
    expect(await checker.isGranted(anonymous, "Edit", "Document", "42")).toBe(false);
    expect(await accessor.run(adminUser, () => ResourcePermissionCheckerExtensions.isGranted(checker, "Edit", new Document("42")))).toBe(true);
    const many = await checker.isGranted(adminUser, ["Edit", "Unknown"], "Document", "42");
    expect(many.result.get("Edit")).toBe(PermissionGrantResult.Granted);
    expect(many.result.get("Unknown")).toBe(PermissionGrantResult.Prohibited);

    const documents = [new Document("42"), new Document("43")];
    await accessor.run(adminUser, () => app.serviceProvider.getRequired(ResourcePermissionPopulator).populate(documents, "Document"));
    expect(documents[0]!.resourcePermissions?.get("Edit")).toBe(true);
    expect(documents[1]!.resourcePermissions?.get("Edit")).toBe(false);

    const service = app.serviceProvider.getRequired(IAbpAuthorizationService);
    expect(await service.authorizeUser(adminUser, new Document("42"), "Edit")).toMatchObject({ succeeded: true });
    expect(await service.authorizeUser(adminUser, new Document("43"), "Edit")).toMatchObject({ succeeded: false });
    await app.shutdown();
  });
});

describe("AbpAuthorizationService and policies", () => {
  it("treats permission names and registered custom policies as policies", async () => {
    const app = await createApp();
    const service = app.serviceProvider.getRequired(IAbpAuthorizationService);
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    expect(await accessor.run(adminUser, () => service.isGranted("Books.Create"))).toBe(true);
    expect(await accessor.run(editorUser, () => service.isGranted("Books.Create"))).toBe(false);
    expect(await accessor.run(editorUser, () => service.isGranted("HasSecretClaim"))).toBe(true);
    expect(await accessor.run(adminUser, () => service.isGranted("HasSecretClaim"))).toBe(false);
    expect(await accessor.run(editorUser, () => service.isGrantedAny("Books.Create", "HasSecretClaim"))).toBe(true);
    expect(await accessor.run(adminUser, () => service.isGranted(new PermissionsRequirement(["Books.Create", "Books"], false)))).toBe(true);
    expect(await accessor.run(adminUser, () => service.isGranted(new PermissionsRequirement(["Books.Create", "Books"], true)))).toBe(false);
    await expect(service.isGranted("No.Such.Policy")).rejects.toThrow("No policy found: No.Such.Policy.");

    const error = await accessor.run(editorUser, () => service.check("Books.Create")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbpAuthorizationException);
    expect(hasErrorCode(error) && error.code).toBe(AbpAuthorizationErrorCodes.GivenPolicyHasNotGrantedWithPolicyName);
    expect((error as AbpAuthorizationException).message).toBe("Authorization failed! Given policy has not granted: Books.Create");
    expect((error as AbpAuthorizationException).data).toEqual({ PolicyName: "Books.Create" });

    const names = await app.serviceProvider.getRequired(IAbpAuthorizationPolicyProvider).getPoliciesNames();
    expect(names).toEqual(expect.arrayContaining(["HasSecretClaim", "Books.Create", "Books"]));
    await app.shutdown();
  });
});

describe("AuthorizationInterceptor", () => {
  it("intercepts classes with Authorize metadata and enforces method and class policies", async () => {
    const app = await createApp();
    const accessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);
    const books = app.serviceProvider.getRequired(BookAppService);
    expect(AuthorizeMetadata.hasAny(BookAppService)).toBe(true);
    expect(AuthorizeMetadata.hasAny(FakePermissionStore)).toBe(false);

    await expect(books.create()).rejects.toBeInstanceOf(AbpAuthorizationException);
    const error = await books.create().catch((e: unknown) => e);
    expect(hasErrorCode(error) && error.code).toBe(AbpAuthorizationErrorCodes.GivenPolicyHasNotGranted);
    expect(await accessor.run(adminUser, () => books.create())).toBe("created");
    await expect(accessor.run(editorUser, () => books.create())).rejects.toBeInstanceOf(AbpAuthorizationException);

    await expect(books.list()).rejects.toBeInstanceOf(AbpAuthorizationException);
    expect(await accessor.run(editorUser, () => books.list())).toBe("listed");
    expect(await books.publicInfo()).toBe("public");
    expect(await books.unprotected()).toBe("unprotected");
    expect(await accessor.run(editorUser, () => books.edit())).toBe("edited");
    await expect(accessor.run(adminUser, () => books.edit())).rejects.toBeInstanceOf(AbpAuthorizationException);
    await expect(accessor.run(adminUser, () => books.broken())).rejects.toThrow(/'Missing.Policy' was not found/);

    const admin = app.serviceProvider.getRequired(AdminAppService);
    await expect(accessor.run(adminUser, () => admin.purge())).rejects.toBeInstanceOf(AbpAuthorizationException);
    TestModule.permissionStore.grant("Books.Delete", "R", "admin");
    await expect(accessor.run(adminUser, () => admin.purge())).rejects.toBeInstanceOf(AbpAuthorizationException);
    await expect(accessor.run(adminUser, () => admin.createToo())).rejects.toBeInstanceOf(AbpAuthorizationException);
    await app.shutdown();
  });

  it("can be replaced by the always-allow services", async () => {
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    addAlwaysAllowAuthorization(app.services);
    await app.initialize();
    expect(await app.serviceProvider.getRequired(BookAppService).create()).toBe("created");
    expect(await app.serviceProvider.getRequired(IPermissionChecker).isGranted("Anything")).toBe(true);
    expect((await app.serviceProvider.getRequired(IPermissionChecker).isGranted(["A", "B"])).allGranted).toBe(true);
    expect(await app.serviceProvider.getRequired(IAbpAuthorizationService).isGranted("Anything")).toBe(true);
    await app.shutdown();
  });
});

describe("NullPermissionStore", () => {
  it("prohibits everything", async () => {
    const store = new NullPermissionStore();
    expect(await store.isGranted()).toBe(false);
    expect((await store.isGrantedMany(["a"])).allProhibited).toBe(true);
  });
});
