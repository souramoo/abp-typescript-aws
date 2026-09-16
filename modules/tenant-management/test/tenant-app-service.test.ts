import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Transient, type Guid } from "@abp/core";
import { addAlwaysAllowAuthorization } from "@abp/authorization";
import { AbpAspNetCoreMvcModule, AbpHttpHost } from "@abp/aws-lambda";
import { DataSeedContributor, type DataSeedContext, type IDataSeedContributor } from "@abp/data";
import { IDistributedEventBus } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpTenantManagementApplicationModule } from "../src/application/index.js";
import type { TenantDto } from "../src/application-contracts/index.js";
import { ITenantAppService } from "../src/application-contracts/index.js";
import { TenantCreatedEto } from "../src/domain-shared/index.js";
import { AbpTenantManagementHttpApiModule } from "../src/http-api/index.js";
import { AbpTenantManagementMemoryDbModule } from "../src/memory-db/index.js";

interface SeedCall {
  readonly tenantId: Guid | undefined;
  readonly currentTenantId: Guid | undefined;
  readonly adminEmail: unknown;
  readonly adminPassword: unknown;
}

const seedCalls: SeedCall[] = [];

@Transient()
@DataSeedContributor()
export class RecordingDataSeedContributor implements IDataSeedContributor {
  static readonly inject = [ICurrentTenant] as const;
  constructor(private readonly currentTenant: ICurrentTenant) {}
  async seed(context: DataSeedContext): Promise<void> {
    seedCalls.push({ tenantId: context.tenantId, currentTenantId: this.currentTenant.id, adminEmail: context.get("AdminEmail"), adminPassword: context.get("AdminPassword") });
  }
}

@DependsOn(AbpTenantManagementHttpApiModule, AbpTenantManagementApplicationModule, AbpTenantManagementMemoryDbModule, AbpAspNetCoreMvcModule)
class TestModule extends AbpModule {}

async function createApp(allowAll: boolean): Promise<AbpApplication> {
  const app = await AbpApplication.create(TestModule, { applicationName: "TenantTests", loggerFactory: NullLoggerFactory.instance, configuration: { skipDefaults: true } });
  if (allowAll) addAlwaysAllowAuthorization(app.services);
  return app;
}

let host: AbpHttpHost;
const createdEtos: TenantCreatedEto[] = [];

beforeAll(async () => {
  host = await AbpHttpHost.create(() => createApp(true));
  host.application.serviceProvider.getRequired(IDistributedEventBus).subscribe(TenantCreatedEto, (eto) => void createdEtos.push(eto));
});
afterAll(() => host.dispose());

function json<T = Record<string, unknown>>(response: { bodyText: string }): T {
  return JSON.parse(response.bodyText) as T;
}

const jsonHeaders = { "content-type": "application/json" };

describe("TenantController (api/multi-tenancy/tenants)", () => {
  let tenantId: Guid;
  let concurrencyStamp: string;

  it("creates a tenant, seeds its data with the admin credentials and publishes TenantCreatedEto", async () => {
    const response = await host.handle({ method: "POST", path: "/api/multi-tenancy/tenants", headers: jsonHeaders, body: JSON.stringify({ name: "Acme", adminEmailAddress: "admin@acme.com", adminPassword: "1q2w3E*" }) });
    expect(response.statusCode).toBe(200);
    const dto = json<TenantDto>(response);
    expect(dto.name).toBe("Acme");
    expect(dto.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dto.concurrencyStamp).toHaveLength(32);
    tenantId = dto.id;
    concurrencyStamp = dto.concurrencyStamp;

    expect(seedCalls).toEqual([{ tenantId, currentTenantId: tenantId, adminEmail: "admin@acme.com", adminPassword: "1q2w3E*" }]);
    expect(createdEtos).toHaveLength(1);
    expect(createdEtos[0]).toMatchObject({ id: tenantId, name: "Acme", properties: { AdminEmail: "admin@acme.com", AdminPassword: "1q2w3E*" } });
  });

  it("rejects invalid input with 400 and duplicate names with the module's business exception", async () => {
    const invalid = await host.handle({ method: "POST", path: "/api/multi-tenancy/tenants", headers: jsonHeaders, body: JSON.stringify({ name: "", adminPassword: "x" }) });
    expect(invalid.statusCode).toBe(400);
    const errors = (json(invalid)["error"] as { validationErrors: { members: string[] }[] }).validationErrors.map((e) => e.members[0]);
    expect(errors).toEqual(expect.arrayContaining(["name", "adminEmailAddress"]));

    const duplicate = await host.handle({ method: "POST", path: "/api/multi-tenancy/tenants", headers: jsonHeaders, body: JSON.stringify({ name: "ACME", adminEmailAddress: "a@b.com", adminPassword: "x" }) });
    expect(duplicate.statusCode).toBe(403);
    expect(json(duplicate)["error"]).toMatchObject({ code: "Volo.Abp.TenantManagement:DuplicateTenantName", message: "Tenant name already exist: ACME" });
  });

  it("gets, lists (filtered, sorted, paged) and updates tenants", async () => {
    const byId = await host.handle({ method: "GET", path: `/api/multi-tenancy/tenants/${tenantId}` });
    expect(byId.statusCode).toBe(200);
    expect(json(byId)).toMatchObject({ id: tenantId, name: "Acme" });

    await host.handle({ method: "POST", path: "/api/multi-tenancy/tenants", headers: jsonHeaders, body: JSON.stringify({ name: "Beta", adminEmailAddress: "b@beta.com", adminPassword: "x" }) });

    const list = json<{ totalCount: number; items: TenantDto[] }>(await host.handle({ method: "GET", path: "/api/multi-tenancy/tenants" }));
    expect(list.totalCount).toBe(2);
    expect(list.items.map((t) => t.name)).toEqual(["Acme", "Beta"]);

    const filtered = json<{ totalCount: number; items: TenantDto[] }>(await host.handle({ method: "GET", path: "/api/multi-tenancy/tenants", query: "filter=Bet&sorting=name%20desc&maxResultCount=1" }));
    expect(filtered.totalCount).toBe(1);
    expect(filtered.items.map((t) => t.name)).toEqual(["Beta"]);

    const updated = await host.handle({ method: "PUT", path: `/api/multi-tenancy/tenants/${tenantId}`, headers: jsonHeaders, body: JSON.stringify({ name: "Acme Corp", concurrencyStamp }) });
    expect(updated.statusCode).toBe(200);
    expect(json(updated)).toMatchObject({ id: tenantId, name: "Acme Corp", concurrencyStamp: expect.any(String) });

    const stale = await host.handle({ method: "PUT", path: `/api/multi-tenancy/tenants/${tenantId}`, headers: jsonHeaders, body: JSON.stringify({ name: "Acme Corp", concurrencyStamp: "0".repeat(32) }) });
    expect(stale.statusCode).toBe(409);
  });

  it("manages the default connection string", async () => {
    const missing = await host.handle({ method: "GET", path: `/api/multi-tenancy/tenants/${tenantId}/default-connection-string` });
    expect(missing.statusCode).toBe(204);

    const set = await host.handle({ method: "PUT", path: `/api/multi-tenancy/tenants/${tenantId}/default-connection-string`, headers: jsonHeaders, body: JSON.stringify("Server=acme;Database=acme") });
    expect(set.statusCode).toBe(204);

    const read = await host.handle({ method: "GET", path: `/api/multi-tenancy/tenants/${tenantId}/default-connection-string` });
    expect(read.statusCode).toBe(200);
    expect(read.bodyText).toBe("Server=acme;Database=acme");

    const removed = await host.handle({ method: "DELETE", path: `/api/multi-tenancy/tenants/${tenantId}/default-connection-string` });
    expect(removed.statusCode).toBe(204);
    expect((await host.handle({ method: "GET", path: `/api/multi-tenancy/tenants/${tenantId}/default-connection-string` })).statusCode).toBe(204);
  });

  it("deletes tenants and answers 404 afterwards", async () => {
    const deleted = await host.handle({ method: "DELETE", path: `/api/multi-tenancy/tenants/${tenantId}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await host.handle({ method: "GET", path: `/api/multi-tenancy/tenants/${tenantId}` });
    expect(gone.statusCode).toBe(404);
    expect((await host.handle({ method: "DELETE", path: `/api/multi-tenancy/tenants/${tenantId}` })).statusCode).toBe(204);
  });

  it("exposes the app service under its token", () => {
    expect(host.application.serviceProvider.get(ITenantAppService)).toBeDefined();
  });
});

describe("TenantController authorization", () => {
  it("requires the AbpTenantManagement.Tenants permissions", async () => {
    const enforcing = await AbpHttpHost.create(() => createApp(false));
    try {
      const response = await enforcing.handle({ method: "GET", path: "/api/multi-tenancy/tenants" });
      expect(response.statusCode).toBe(401);
    } finally {
      await enforcing.dispose();
    }
  });
});
