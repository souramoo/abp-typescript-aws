import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, isBusinessException, type IHasErrorCode } from "@abp/core";
import { IConnectionStringResolver } from "@abp/data";
import { AbpTenantResolveOptions, ICurrentTenant, IMultiTenantUrlProvider, ITenantConfigurationProvider, ITenantResolver, ITenantStore, TenantConfiguration, TenantResolveContributorBase, type ITenantResolveContext } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim, ICurrentPrincipalAccessor } from "@abp/security";
import { AbpMultiTenancyErrorCodes, AbpMultiTenancyModule, ActionTenantResolveContributor, CurrentUserTenantResolveContributor, MultiTenantConnectionStringResolver, resolveCurrentTenant } from "../src/index.js";

const acmeId = "11111111-1111-4111-8111-111111111111";
const inactiveId = "22222222-2222-4222-8222-222222222222";
const volosoftId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

class HeaderTenantResolveContributor extends TenantResolveContributorBase {
  static tenant: string | undefined;
  readonly name = "Header";
  async resolve(context: ITenantResolveContext): Promise<void> {
    context.tenantIdOrName = HeaderTenantResolveContributor.tenant;
  }
}

@DependsOn(AbpMultiTenancyModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpTenantResolveOptions, (o) => {
      o.tenantResolvers.push(new HeaderTenantResolveContributor());
    });
  }
}

async function createApp() {
  const app = await AbpApplication.create(TestModule, {
    configuration: {
      skipDefaults: true,
      values: {
        ConnectionStrings: { Default: "Table=Host", AbpIdentity: "Table=HostIdentity" },
        Tenants: [
          { Id: acmeId, Name: "acme", ConnectionStrings: { Default: "Table=Acme", AbpIdentity: "Table=AcmeIdentity" } },
          { Id: inactiveId, Name: "inactive", IsActive: false },
        ],
      },
    },
  });
  app.services.options.configure(AbpTenantResolveOptions, (o) => {
    o.tenantResolvers.push(new ActionTenantResolveContributor((ctx) => void (ctx.items.get("fallback") === true && (ctx.tenantIdOrName = "volosoft"))));
  });
  await app.initialize();
  return app;
}

describe("tenant store", () => {
  it("loads tenants from configuration and finds by id or name", async () => {
    const app = await createApp();
    const store = app.serviceProvider.getRequired(ITenantStore);
    expect((await store.getList()).map((t) => t.name)).toEqual(["acme", "inactive"]);
    expect((await store.findById(acmeId))?.normalizedName).toBe("ACME");
    expect((await store.findByName("ACME"))?.id).toBe(acmeId);
    expect((await store.find(acmeId))?.name).toBe("acme");
    expect((await store.find("ACME"))?.connectionStrings?.default).toBe("Table=Acme");
    expect((await store.findById(inactiveId))?.isActive).toBe(false);
    expect(await store.findByName("nope")).toBeUndefined();
    await app.shutdown();
  });
});

describe("tenant resolution", () => {
  it("runs the contributor chain with the current user first and reports applied resolvers", async () => {
    const app = await createApp();
    const resolver = app.serviceProvider.getRequired(ITenantResolver);
    const principalAccessor = app.serviceProvider.getRequired(ICurrentPrincipalAccessor);

    HeaderTenantResolveContributor.tenant = "acme";
    const byHeader = await resolver.resolveTenantIdOrName();
    expect(byHeader.tenantIdOrName).toBe("acme");
    expect(byHeader.appliedResolvers).toEqual([CurrentUserTenantResolveContributor.ContributorName, "Header"]);

    HeaderTenantResolveContributor.tenant = undefined;
    const none = await resolver.resolveTenantIdOrName();
    expect(none.tenantIdOrName).toBeUndefined();
    expect(none.appliedResolvers).toEqual(["CurrentUser", "Header", "Action"]);

    const byUser = await principalAccessor.run([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.tenantId, acmeId)], () => resolver.resolveTenantIdOrName());
    expect(byUser.tenantIdOrName).toBe(acmeId);
    expect(byUser.appliedResolvers).toEqual(["CurrentUser"]);

    const hostUser = await principalAccessor.run([new Claim(AbpClaimTypes.userId, userId)], () => resolver.resolveTenantIdOrName());
    expect(hostUser.tenantIdOrName).toBeUndefined();
    expect(hostUser.appliedResolvers).toEqual(["CurrentUser"]);
    await app.shutdown();
  });

  it("provides the tenant configuration and throws ABP error codes for unknown or inactive tenants", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ITenantConfigurationProvider);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);

    HeaderTenantResolveContributor.tenant = "Acme";
    expect((await provider.get())?.id).toBe(acmeId);
    expect(await resolveCurrentTenant(app.serviceProvider)).toEqual({ tenantId: acmeId, name: "acme" });
    expect(currentTenant.id).toBeUndefined();

    HeaderTenantResolveContributor.tenant = undefined;
    expect(await provider.get()).toBeUndefined();
    expect(await resolveCurrentTenant(app.serviceProvider)).toBeUndefined();

    HeaderTenantResolveContributor.tenant = "unknown";
    const notFound = await provider.get().catch((e: unknown) => e);
    expect(isBusinessException(notFound)).toBe(true);
    expect((notFound as IHasErrorCode).code).toBe(AbpMultiTenancyErrorCodes.TenantNotFound);
    expect((notFound as IHasErrorCode).code).toBe("Volo.AbpIo.MultiTenancy:010001");

    HeaderTenantResolveContributor.tenant = inactiveId;
    const inactive = await provider.get().catch((e: unknown) => e);
    expect((inactive as IHasErrorCode).code).toBe(AbpMultiTenancyErrorCodes.TenantNotActive);
    await app.shutdown();
  });
});

describe("MultiTenantConnectionStringResolver", () => {
  it("replaces the default resolver and prefers tenant connection strings", async () => {
    const app = await createApp();
    const resolver = app.serviceProvider.getRequired(IConnectionStringResolver);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    expect(resolver).toBeInstanceOf(MultiTenantConnectionStringResolver);
    expect(app.serviceProvider.getAll(IConnectionStringResolver)).toHaveLength(1);

    expect(await resolver.resolve()).toBe("Table=Host");
    expect(await resolver.resolve("AbpIdentity")).toBe("Table=HostIdentity");

    await currentTenant.run(acmeId, "acme", async () => {
      expect(await resolver.resolve()).toBe("Table=Acme");
      expect(await resolver.resolve("AbpIdentity")).toBe("Table=AcmeIdentity");
      expect(await resolver.resolve("AbpAuditLogging")).toBe("Table=Acme");
    });
    await currentTenant.run(inactiveId, undefined, async () => {
      expect(await resolver.resolve("AbpIdentity")).toBe("Table=HostIdentity");
    });
    await currentTenant.run(volosoftId, undefined, async () => {
      expect(await resolver.resolve()).toBe("Table=Host");
    });
    await app.shutdown();
  });

  it("MultiTenantUrlProvider fills placeholders for the current tenant", async () => {
    const app = await createApp();
    const urlProvider = app.serviceProvider.getRequired(IMultiTenantUrlProvider);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    expect(await urlProvider.getUrl("https://{{tenantName}}.abp.io")).toBe("https://abp.io");
    await currentTenant.run(acmeId, undefined, async () => {
      expect(await urlProvider.getUrl("https://{{tenantName}}.abp.io/{{tenantId}}")).toBe(`https://acme.abp.io/${acmeId}.`);
    });
    expect(new TenantConfiguration(volosoftId, "Volosoft").normalizedName).toBe("VOLOSOFT");
    await app.shutdown();
  });
});
