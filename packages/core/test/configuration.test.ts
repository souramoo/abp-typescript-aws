import { describe, expect, it } from "vitest";
import { AmbientScopeProvider, ConfigurationBuilder, CultureHelper, BusinessException, UserFriendlyException, isBusinessException, isUserFriendlyException, toKebabCase, formatNamed, Check, LogLevel } from "../src/index.js";

describe("Configuration", () => {
  it("reads nested keys case-insensitively and binds objects", () => {
    process.env["TESTCFG__Abp__Auditing__IsEnabled"] = "false";
    const cfg = new ConfigurationBuilder().addInMemory({ Abp: { Auditing: { IsEnabled: true, Ignored: ["a", "b"] }, Name: "x" } }).addEnvironmentVariables("TESTCFG__").build();
    expect(cfg.get("abp:auditing:isenabled")).toBe("false");
    expect(cfg.get("Abp:Name")).toBe("x");
    expect(cfg.getSection("Abp:Auditing").toObject()).toEqual({ IsEnabled: false, Ignored: ["a", "b"] });
    expect(cfg.getSection("Nope").exists()).toBe(false);
    expect(cfg.getSection("Abp").getChildren().map((c) => c.key).sort()).toEqual(["auditing", "name"]);
  });
});

describe("AmbientScopeProvider", () => {
  it("scopes values with disposables and callbacks", async () => {
    const p = new AmbientScopeProvider<string>();
    expect(p.getValue("k")).toBeUndefined();
    {
      using _scope = p.beginScope("k", "a");
      expect(p.getValue("k")).toBe("a");
      await p.run("k", "b", async () => {
        await Promise.resolve();
        expect(p.getValue("k")).toBe("b");
      });
      expect(p.getValue("k")).toBe("a");
    }
    expect(p.getValue("k")).toBeUndefined();
  });

  it("CultureHelper uses ambient culture", () => {
    expect(CultureHelper.currentCulture).toBe("en");
    CultureHelper.run("tr", () => expect(CultureHelper.currentCulture).toBe("tr"));
    expect(CultureHelper.getBaseCultureName("en-GB")).toBe("en");
  });
});

describe("exceptions and helpers", () => {
  it("BusinessException carries code/details/data", () => {
    const e = new BusinessException({ code: "MyApp:001", details: "d" }).withData("Name", "x");
    expect(isBusinessException(e)).toBe(true);
    expect(isUserFriendlyException(e)).toBe(false);
    expect(e.code).toBe("MyApp:001");
    expect(e.data["Name"]).toBe("x");
    expect(e.logLevel).toBe(LogLevel.Warning);
    expect(isUserFriendlyException(new UserFriendlyException("hi"))).toBe(true);
  });
  it("string helpers", () => {
    expect(toKebabCase("IdentityUserAppService")).toBe("identity-user-app-service");
    expect(formatNamed("Hi {name}", { name: "abp" })).toBe("Hi abp");
    expect(() => Check.notNullOrWhiteSpace(" ", "p")).toThrow(/p can not be null/);
  });
});
