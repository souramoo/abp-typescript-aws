import { AbpApplication, AbpModule, DependsOn, Guid, LocalizableString } from "@abp/core";
import { AbpValidationException, IObjectValidator, ValidationContext, createValidationResult, getValidationErrors } from "@abp/validation";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AbpObjectExtendingModule,
  ExtensibleObject,
  ExtensibleObjectMapper,
  ExtensibleObjectValidator,
  ExtensionPropertyHelper,
  ExtraPropertyDictionary,
  MappingPropertyDefinitionChecks,
  ObjectExtensionManager,
  getProperty,
  getPropertyAs,
  hasProperty,
  hasSameExtraProperties,
  mapExtraPropertiesTo,
  removeProperty,
  setDefaultsForExtraProperties,
  setExtraPropertiesToRegularProperties,
  setProperty,
  type IHasExtraProperties,
} from "../src/index.js";

class IdentityUser extends ExtensibleObject {
  name = "";
}

class IdentityUserDto extends ExtensibleObject {
  name = "";
}

class PlainEntity implements IHasExtraProperties {
  readonly extraProperties = new ExtraPropertyDictionary();
  title = "";
}

class Unextended extends ExtensibleObject {}

class UserOnly extends ExtensibleObject {}
class DtoOnly extends ExtensibleObject {}

ObjectExtensionManager.instance
  .addOrUpdate(IdentityUser, (user) => {
    user
      .addOrUpdateProperty("string", "SocialSecurityNumber", (p) => {
        p.type = z.string().min(3).max(9).nullish();
        p.displayName = LocalizableString.create(IdentityUser, "SSN");
        p.ui.order = 2;
      })
      .addOrUpdateProperty("number", "Age", (p) => {
        p.ui.order = 1;
        p.validators.push((ctx) => {
          if (typeof ctx.value === "number" && ctx.value > 150) ctx.validationErrors.push(createValidationResult("Nobody is that old", ctx.extensionPropertyInfo.name));
        });
      })
      .addOrUpdateProperty("boolean", "IsVip")
      .addOrUpdateProperty("guid", "ManagerId")
      .addOrUpdateProperty("Title", (p) => {
        p.defaultValueFactory = () => "Mr";
      })
      .addOrUpdateProperty(z.enum(["Gold", "Silver"]).default("Silver"), "Tier")
      .addOrUpdateProperty("SourceOnly", (p) => {
        p.checkPairDefinitionOnMapping = false;
      })
      .addOrUpdateProperty("UserOnlyStrict");
    user.validators.push((ctx) => {
      if (getProperty(ctx.validatingObject, "Age") === 42 && getProperty(ctx.validatingObject, "IsVip") === false) {
        ctx.validationErrors.push(createValidationResult("42 must be VIP"));
      }
    });
  })
  .addOrUpdateProperty(IdentityUserDto, "string", "SocialSecurityNumber")
  .addOrUpdateProperty(IdentityUserDto, "number", "Age")
  .addOrUpdateProperty(IdentityUserDto, "boolean", "IsVip")
  .addOrUpdateProperty(IdentityUserDto, "guid", "ManagerId")
  .addOrUpdateProperty(IdentityUserDto, "string", "Title")
  .addOrUpdateProperty(IdentityUserDto, z.enum(["Gold", "Silver"]), "Tier")
  .addOrUpdateProperty(IdentityUserDto, "string", "DtoOnlyLoose", (p) => {
    p.checkPairDefinitionOnMapping = false;
  })
  .addOrUpdateProperty(IdentityUserDto, "string", "DtoOnlyStrict")
  .addOrUpdateProperty(PlainEntity, "number", "Count")
  .addOrUpdateProperty(UserOnly, "string", "A")
  .addOrUpdateProperty(DtoOnly, "string", "B");

describe("ExtraPropertyDictionary", () => {
  it("is a Map that serializes to a plain object", () => {
    const dict = new ExtraPropertyDictionary({ a: 1, b: "x" });
    expect(JSON.parse(JSON.stringify({ extraProperties: dict }))).toEqual({ extraProperties: { a: 1, b: "x" } });
    expect(ExtraPropertyDictionary.fromObject({ a: 1 }).get("a")).toBe(1);
    expect(new ExtraPropertyDictionary([["k", true]]).get("k")).toBe(true);
    expect(dict.hasSameItems(new ExtraPropertyDictionary({ a: "1", b: "x" }))).toBe(true);
    expect(dict.hasSameItems(new ExtraPropertyDictionary({ a: 2, b: "x" }))).toBe(false);
    expect(dict.hasSameItems(new ExtraPropertyDictionary({ a: 1 }))).toBe(false);
  });
});

describe("ObjectExtensionManager / ObjectExtensionInfo", () => {
  it("defines properties, keeps the first type, orders by ui.order and derives defaults", () => {
    const extension = ObjectExtensionManager.instance.getOrNull(IdentityUser)!;
    expect(extension.type).toBe(IdentityUser);
    expect(extension.hasProperty("Age")).toBe(true);
    expect(extension.getProperties().slice(-2).map((p) => p.name)).toEqual(["Age", "SocialSecurityNumber"]);
    expect(ObjectExtensionManager.instance.getPropertyOrNull(IdentityUser, "Nope")).toBeUndefined();
    expect(ObjectExtensionManager.instance.getProperties(Unextended)).toEqual([]);
    expect(ObjectExtensionManager.instance.getOrNull(Unextended)).toBeUndefined();

    ObjectExtensionManager.instance.addOrUpdateProperty(IdentityUser, "boolean", "Age");
    expect(ObjectExtensionManager.instance.getPropertyOrNull(IdentityUser, "Age")!.type).toBe("number");

    const props = Object.fromEntries(extension.getProperties().map((p) => [p.name, p]));
    expect(props["Age"]!.getDefaultValue()).toBe(0);
    expect(props["IsVip"]!.getDefaultValue()).toBe(false);
    expect(props["ManagerId"]!.getDefaultValue()).toBe(Guid.empty);
    expect(props["SocialSecurityNumber"]!.getDefaultValue()).toBeUndefined();
    expect(props["Title"]!.getDefaultValue()).toBe("Mr");
    expect(props["Tier"]!.getDefaultValue()).toBe("Silver");
    expect(props["SocialSecurityNumber"]!.displayName).toBeInstanceOf(LocalizableString);
    expect(ExtensionPropertyHelper.getTypeDefaultValue(z.number().default(7))).toBe(7);
    expect(ObjectExtensionManager.instance.getExtendedObjects().map((e) => e.type)).toContain(IdentityUserDto);
  });
});

describe("IHasExtraProperties helpers", () => {
  it("ExtensibleObject sets defaults for the concrete class on construction", () => {
    const user = new IdentityUser();
    expect(user.extraProperties.toObject()).toEqual({ Age: 0, SocialSecurityNumber: undefined, IsVip: false, ManagerId: Guid.empty, Title: "Mr", Tier: "Silver", SourceOnly: undefined, UserOnlyStrict: undefined });
    expect(new IdentityUser(false).extraProperties.size).toBe(0);
    expect(hasProperty(user, "Age")).toBe(true);
    expect(getProperty(user, "Nope", "dflt")).toBe("dflt");
    expect(getPropertyAs(user, "Age", z.number())).toBe(0);
    expect(getPropertyAs(user, "Title", z.string())).toBe("Mr");
    expect(getPropertyAs(user, "Nope", z.string(), "d")).toBe("d");
    setProperty(user, "Age", "5", false);
    expect(getPropertyAs(user, "Age", z.coerce.number())).toBe(5);
    expect(() => getPropertyAs(user, "Age", z.number())).toThrow();
    removeProperty(user, "Age");
    expect(hasProperty(user, "Age")).toBe(false);
    setDefaultsForExtraProperties(user);
    expect(getProperty(user, "Age")).toBe(0);
  });

  it("setProperty validates against the definition unless validate is false", () => {
    const user = new IdentityUser();
    setProperty(user, "SocialSecurityNumber", "123456789");
    expect(getProperty(user, "SocialSecurityNumber")).toBe("123456789");
    expect(() => setProperty(user, "SocialSecurityNumber", "12")).toThrow(AbpValidationException);
    expect(() => setProperty(user, "Age", "not a number")).toThrow(AbpValidationException);
    expect(() => setProperty(user, "Age", 200)).toThrowError(expect.objectContaining({ validationErrors: [{ errorMessage: "Nobody is that old", memberNames: ["Age"] }] }));
    expect(() => setProperty(user, "Tier", "Bronze")).toThrow(AbpValidationException);
    setProperty(user, "Tier", "Gold");
    setProperty(user, "Undefined", "anything goes");
    setProperty(user, "Age", 200, false);
    expect(getProperty(user, "Age")).toBe(200);
    expect(() => setProperty(new Unextended(), "X", 1)).not.toThrow();
  });

  it("moves extra properties to regular properties and compares dictionaries", () => {
    const entity = new PlainEntity();
    entity.extraProperties.set("title", "T").set("Count", 3);
    setExtraPropertiesToRegularProperties(entity);
    expect(entity.title).toBe("T");
    expect(entity.extraProperties.toObject()).toEqual({ Count: 3 });
    const other = new PlainEntity();
    other.extraProperties.set("Count", "3");
    expect(hasSameExtraProperties(entity, other)).toBe(true);
  });
});

describe("ExtensibleObjectValidator", () => {
  it("validates all defined properties, custom property validators and object validators", () => {
    const user = new IdentityUser();
    setProperty(user, "Age", 42, false);
    setProperty(user, "SocialSecurityNumber", "12", false);
    (user.extraProperties as Map<string, unknown>).set("ManagerId", null);
    const errors = ExtensibleObjectValidator.getValidationErrors(user);
    expect(errors).toEqual([
      { errorMessage: "The ManagerId field is required.", memberNames: ["ManagerId"] },
      { errorMessage: expect.stringContaining("Too small"), memberNames: ["SocialSecurityNumber"] },
      { errorMessage: "42 must be VIP", memberNames: [] },
    ]);
    expect(ExtensibleObjectValidator.isValid(user)).toBe(false);
    expect(ExtensibleObjectValidator.isValid(new IdentityUser())).toBe(true);
    expect(ExtensibleObjectValidator.isPropertyValid(user, "Age", 1)).toBe(true);
    expect(ExtensibleObjectValidator.isPropertyValid(user, "Age", 151)).toBe(false);
    expect(ExtensibleObjectValidator.getValidationErrors(new Unextended())).toEqual([]);
    expect(user.validate(new ValidationContext(user))).toHaveLength(3);
  });

  it("participates in @abp/validation for ExtensibleObject (via validate) and plain IHasExtraProperties (via contributor)", async () => {
    const user = new IdentityUser();
    setProperty(user, "Age", 200, false);
    const viaZodContributor = await getValidationErrors(user);
    expect(viaZodContributor).toEqual([{ errorMessage: "Nobody is that old", memberNames: ["Age"] }]);

    @DependsOn(AbpObjectExtendingModule)
    class TestModule extends AbpModule {}
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const validator = app.serviceProvider.getRequired(IObjectValidator);
    await expect(validator.getErrorsAsync(user)).resolves.toEqual([{ errorMessage: "Nobody is that old", memberNames: ["Age"] }]);

    const plain = new PlainEntity();
    plain.extraProperties.set("Count", "many");
    await expect(validator.getErrorsAsync(plain)).resolves.toEqual([{ errorMessage: expect.stringContaining("expected number"), memberNames: ["Count"] }]);
    plain.extraProperties.set("Count", 2);
    await expect(validator.validateAsync(plain)).resolves.toBeUndefined();
    await app.shutdown();
  });
});

describe("ExtensibleObjectMapper", () => {
  function sourceUser(): IdentityUser {
    const user = new IdentityUser(false);
    user.extraProperties.set("Age", 30).set("SocialSecurityNumber", "123456").set("Title", "Dr").set("SourceOnly", "s").set("UserOnlyStrict", "u").set("DtoOnlyLoose", "l").set("DtoOnlyStrict", "d").set("Undefined", "x");
    return user;
  }

  it("maps with the default pair-definition logic", () => {
    const dto = new IdentityUserDto(false);
    mapExtraPropertiesTo(sourceUser(), dto);
    expect(dto.extraProperties.toObject()).toEqual({ Age: 30, SocialSecurityNumber: "123456", Title: "Dr", SourceOnly: "s", DtoOnlyLoose: "l" });
  });

  it("honours explicit definition checks and ignored properties", () => {
    const all = new IdentityUserDto(false);
    mapExtraPropertiesTo(sourceUser(), all, MappingPropertyDefinitionChecks.None, ["Undefined"]);
    expect(Object.keys(all.extraProperties.toObject()).sort()).toEqual(["Age", "DtoOnlyLoose", "DtoOnlyStrict", "SocialSecurityNumber", "SourceOnly", "Title", "UserOnlyStrict"]);

    const source = new IdentityUserDto(false);
    mapExtraPropertiesTo(sourceUser(), source, MappingPropertyDefinitionChecks.Source);
    expect(Object.keys(source.extraProperties.toObject()).sort()).toEqual(["Age", "SocialSecurityNumber", "SourceOnly", "Title", "UserOnlyStrict"]);

    const destination = new IdentityUserDto(false);
    mapExtraPropertiesTo(sourceUser(), destination, MappingPropertyDefinitionChecks.Destination);
    expect(Object.keys(destination.extraProperties.toObject()).sort()).toEqual(["Age", "DtoOnlyLoose", "DtoOnlyStrict", "SocialSecurityNumber", "Title"]);

    const both = new IdentityUserDto(false);
    mapExtraPropertiesTo(sourceUser(), both, MappingPropertyDefinitionChecks.Both);
    expect(Object.keys(both.extraProperties.toObject()).sort()).toEqual(["Age", "SocialSecurityNumber", "Title"]);

    const nullChecks = new IdentityUserDto(false);
    mapExtraPropertiesTo(sourceUser(), nullChecks, MappingPropertyDefinitionChecks.Null);
    expect(Object.keys(nullChecks.extraProperties.toObject()).length).toBe(5);

    const nothing = new DtoOnly(false);
    mapExtraPropertiesTo(new UserOnly(false), nothing, MappingPropertyDefinitionChecks.Both);
    expect(nothing.extraProperties.size).toBe(0);
  });

  it("validates mapped values against the destination definition", () => {
    const user = new IdentityUser(false);
    user.extraProperties.set("Age", "thirty");
    expect(() => mapExtraPropertiesTo(user, new IdentityUserDto(false))).toThrow(AbpValidationException);
  });

  it("maps raw dictionaries by class and answers canMapProperty", () => {
    const destination = new Map<string, unknown>();
    ExtensibleObjectMapper.mapExtraPropertyDictionaryTo(IdentityUser, IdentityUserDto, sourceUser().extraProperties, destination, MappingPropertyDefinitionChecks.Both);
    expect([...destination.keys()].sort()).toEqual(["Age", "SocialSecurityNumber", "Title"]);
    expect(ExtensibleObjectMapper.canMapProperty(IdentityUser, IdentityUserDto, "SourceOnly")).toBe(true);
    expect(ExtensibleObjectMapper.canMapProperty(IdentityUser, IdentityUserDto, "UserOnlyStrict")).toBe(false);
    expect(ExtensibleObjectMapper.canMapProperty(IdentityUser, IdentityUserDto, "Age", MappingPropertyDefinitionChecks.None, ["Age"])).toBe(false);
  });
});
