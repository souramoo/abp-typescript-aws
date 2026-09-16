import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, delay } from "@abp/core";
import { AbpMultiTenancyAbstractionsModule, ConnectionStrings, ICurrentTenant, ITenantNormalizer, MultiTenancySides, TenantConfiguration, getCurrentTenantId, getMultiTenancySide, hasMultiTenancySide } from "../src/index.js";

@DependsOn(AbpMultiTenancyAbstractionsModule)
class TestModule extends AbpModule {}

const t1 = "11111111-1111-4111-8111-111111111111";
const t2 = "22222222-2222-4222-8222-222222222222";

describe("ICurrentTenant", () => {
  it("change nests and restores, run isolates concurrent flows", async () => {
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);
    expect(currentTenant.isAvailable).toBe(false);
    expect(getMultiTenancySide(currentTenant)).toBe(MultiTenancySides.Host);
    expect(() => getCurrentTenantId(currentTenant)).toThrow(/not available/);

    const outer = currentTenant.change(t1, "acme");
    expect(currentTenant.id).toBe(t1);
    expect(currentTenant.name).toBe("acme");
    const inner = currentTenant.change(null);
    expect(currentTenant.isAvailable).toBe(false);
    inner[Symbol.dispose]();
    expect(currentTenant.id).toBe(t1);
    outer[Symbol.dispose]();
    expect(currentTenant.id).toBeUndefined();

    const seen = await Promise.all(
      [t1, t2].map((id, i) =>
        currentTenant.run(id, `tenant${i}`, async () => {
          await delay(5 - i * 2);
          return `${currentTenant.id}:${currentTenant.name}`;
        }),
      ),
    );
    expect(seen).toEqual([`${t1}:tenant0`, `${t2}:tenant1`]);
    expect(currentTenant.id).toBeUndefined();
    expect(app.serviceProvider.getRequired(ITenantNormalizer).normalizeName("Acme")).toBe("ACME");
    await app.shutdown();
  });
});

describe("TenantConfiguration / ConnectionStrings / sides", () => {
  it("defaults normalized name and default connection string semantics", () => {
    const tenant = new TenantConfiguration(t1, "Acme");
    expect(tenant.normalizedName).toBe("ACME");
    expect(tenant.isActive).toBe(true);
    tenant.connectionStrings!.default = "Server=acme";
    expect(tenant.connectionStrings!.get(ConnectionStrings.DefaultConnectionStringName)).toBe("Server=acme");
    expect(new ConnectionStrings({ Default: "x", Identity: "y" }).getOrDefault("Identity")).toBe("y");
    expect(hasMultiTenancySide(MultiTenancySides.Both, MultiTenancySides.Host)).toBe(true);
    expect(hasMultiTenancySide(MultiTenancySides.Tenant, MultiTenancySides.Host)).toBe(false);
  });
});
