import { describe, expect, it } from "vitest";
import { OrganizationUnit } from "../src/domain/index.js";

describe("OrganizationUnit codes", () => {
  it("creates, appends, splits and increments codes as in Volo.Abp.Identity", () => {
    expect(OrganizationUnit.createCode(1)).toBe("00001");
    expect(OrganizationUnit.createCode(1, 2, 3)).toBe("00001.00002.00003");
    expect(OrganizationUnit.createCode()).toBeUndefined();
    expect(OrganizationUnit.appendCode("00001", "00002")).toBe("00001.00002");
    expect(OrganizationUnit.appendCode(undefined, "00002")).toBe("00002");
    expect(OrganizationUnit.getRelativeCode("00001.00002.00003", "00001")).toBe("00002.00003");
    expect(OrganizationUnit.getRelativeCode("00001.00002.00003", undefined)).toBe("00001.00002.00003");
    expect(OrganizationUnit.calculateNextCode("00001.00002")).toBe("00001.00003");
    expect(() => OrganizationUnit.calculateNextCode(undefined)).toThrow();
    expect(OrganizationUnit.getLastUnitCode("00001.00002.00003")).toBe("00003");
    expect(OrganizationUnit.getParentCode("00001.00002.00003")).toBe("00001.00002");
    expect(OrganizationUnit.getParentCode("00001")).toBeUndefined();
  });

  it("tracks role assignments", () => {
    const ou = new OrganizationUnit("11111111-1111-4111-8111-111111111111", "Root", undefined, undefined);
    ou.addRole("22222222-2222-4222-8222-222222222222");
    ou.addRole("22222222-2222-4222-8222-222222222222");
    expect(ou.roles).toHaveLength(1);
    expect(ou.isInRole("22222222-2222-4222-8222-222222222222")).toBe(true);
    ou.removeRole("22222222-2222-4222-8222-222222222222");
    expect(ou.isInRole("22222222-2222-4222-8222-222222222222")).toBe(false);
  });
});
