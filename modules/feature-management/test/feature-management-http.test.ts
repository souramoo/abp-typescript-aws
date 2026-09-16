import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FeatureDto, GetFeatureListResultDto } from "../src/application-contracts/index.js";
import { FeatureManagerExtensions, IFeatureManager } from "../src/domain/index.js";
import { FeaturesController } from "../src/http-api/index.js";
import { AuthenticatedHeaders, TenantHeaders, TestFeatures, createHttpTest, host, json, tenantA } from "./test-support.js";

const test = createHttpTest();
beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const jsonHeaders = { ...AuthenticatedHeaders, "content-type": "application/json" };
const tenantQuery = `providerName=T&providerKey=${tenantA}`;

function testGroup(result: GetFeatureListResultDto): FeatureDto[] {
  return result.groups.find((g) => g.name === TestFeatures.GroupName)!.features;
}

describe("api/feature-management/features", () => {
  it("lists the features of a tenant with their definitions, values and depth", async () => {
    const response = await host(test).handle({ method: "GET", path: "/api/feature-management/features", query: tenantQuery, headers: AuthenticatedHeaders });
    expect(response.statusCode).toBe(200);
    const features = testGroup(json<GetFeatureListResultDto>(response));
    expect(features.map((f) => f.name)).toEqual([TestFeatures.Boolean, TestFeatures.BooleanChild, TestFeatures.Number, TestFeatures.TenantOnly]);
    expect(features[0]).toMatchObject({ displayName: "Manage host features", value: "false", depth: 0, provider: { name: "D" }, valueType: { name: "ToggleStringValueType", validator: { name: "BOOLEAN" } } });
    expect(features[1]).toMatchObject({ parentName: TestFeatures.Boolean, depth: 1 });
    expect(features[2]?.valueType).toMatchObject({ name: "FreeTextStringValueType", validator: { name: "NUMERIC", properties: { MinValue: 0, MaxValue: 100 } } });
  });

  it("hides host-unavailable features from the host and requires ManageHostFeatures there", async () => {
    const response = await host(test).handle({ method: "GET", path: "/api/feature-management/features", query: "providerName=T", headers: AuthenticatedHeaders });
    expect(response.statusCode).toBe(200);
    expect(testGroup(json<GetFeatureListResultDto>(response)).map((f) => f.name)).not.toContain(TestFeatures.TenantOnly);

    const anonymous = await host(test).handle({ method: "GET", path: "/api/feature-management/features", query: tenantQuery });
    expect(anonymous.statusCode).toBe(401);
  });

  it("updates a tenant's features (children first, parents forced) and deletes them", async () => {
    const body = JSON.stringify({ features: [{ name: TestFeatures.Boolean, value: "false" }, { name: TestFeatures.BooleanChild, value: "true" }, { name: TestFeatures.Number, value: "7" }] });
    const updated = await host(test).handle({ method: "PUT", path: "/api/feature-management/features", query: tenantQuery, headers: jsonHeaders, body });
    expect(updated.statusCode).toBe(204);

    const features = testGroup(json<GetFeatureListResultDto>(await host(test).handle({ method: "GET", path: "/api/feature-management/features", query: tenantQuery, headers: AuthenticatedHeaders })));
    expect(features.find((f) => f.name === TestFeatures.Boolean)).toMatchObject({ value: "false", provider: { name: "T", key: tenantA } });
    expect(features.find((f) => f.name === TestFeatures.BooleanChild)).toMatchObject({ value: "true", provider: { name: "T", key: tenantA } });
    expect(features.find((f) => f.name === TestFeatures.Number)).toMatchObject({ value: "7", provider: { name: "T", key: tenantA } });

    const invalid = await host(test).handle({ method: "PUT", path: "/api/feature-management/features", query: tenantQuery, headers: jsonHeaders, body: JSON.stringify({ features: [{ name: TestFeatures.Number, value: "x" }] }) });
    expect(invalid.statusCode).toBe(403);
    expect(json(invalid)["error"]).toMatchObject({ code: "Volo.Abp.FeatureManagement:InvalidFeatureValue", message: "Test.Number feature value is not valid!" });

    const deleted = await host(test).handle({ method: "DELETE", path: "/api/feature-management/features", query: tenantQuery, headers: AuthenticatedHeaders });
    expect(deleted.statusCode).toBe(204);
    expect(await FeatureManagerExtensions.getAllForTenant(test.getRequiredService(IFeatureManager), tenantA, false)).toEqual([]);
  });

  it("uses the current tenant's policy when a tenant user reads its own features", async () => {
    const response = await host(test).handle({ method: "GET", path: "/api/feature-management/features", query: "providerName=T", headers: TenantHeaders });
    expect(response.statusCode).toBe(200);
    expect(testGroup(json<GetFeatureListResultDto>(response)).map((f) => f.name)).toContain(TestFeatures.TenantOnly);
  });

  it("delegates 1:1 to the application service", () => {
    expect(test.getRequiredService(FeaturesController)).toBeInstanceOf(FeaturesController);
  });
});
