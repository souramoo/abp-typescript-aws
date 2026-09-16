import { AbpApplication, AbpModule, CultureHelper, DependsOn, IStringLocalizerFactory, LocalizableString, ServiceCollection, fixedString, optionsToken } from "@abp/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AbpEnumLocalizer,
  AbpLocalizationModule,
  AbpLocalizationOptions,
  AbpLocalizationResource,
  AbpStringLocalizerFactory,
  DefaultLanguageProvider,
  DefaultResource,
  IAbpEnumLocalizer,
  ILanguageProvider,
  ILocalizableStringSerializer,
  InheritResource,
  JsonLocalizationDictionaryBuilder,
  LanguageInfo,
  LocalizableStringSerializer,
  LocalizationResourceName,
  NullExternalLocalizationStore,
  ResourceNameLocalizableString,
  findByCulture,
  getLocalizationResourceName,
  isAbpStringLocalizer,
  parseLanguageSetting,
  stringLocalizerToken,
} from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

@LocalizationResourceName("Base")
class BaseResource {}

@LocalizationResourceName("Test")
@InheritResource(BaseResource)
class TestResource {}

class UnnamedResource {}

function createFactory(configure: (options: AbpLocalizationOptions) => void): AbpStringLocalizerFactory {
  const services = new ServiceCollection();
  services.options.configure(AbpLocalizationOptions, configure);
  services.addSingleton(NullExternalLocalizationStore);
  const provider = services.buildServiceProvider();
  return new AbpStringLocalizerFactory(provider.getRequired(optionsToken(AbpLocalizationOptions)), provider, provider.getRequired(NullExternalLocalizationStore));
}

function configureTestResources(options: AbpLocalizationOptions): void {
  options.resources.add(BaseResource, "en").addJson({ culture: "en", texts: { FromBase: "From base (en)", Shared: "Shared from base" } }, { culture: "tr", texts: { FromBase: "From base (tr)" } });
  options.resources.add(TestResource, "en").addJsonFilesFromDirectory(fixtures).addJson({ culture: "en", texts: { Shared: "Shared from test" } });
  options.defaultResourceType = TestResource;
}

describe("LocalizationResourceName", () => {
  it("uses the attribute name or falls back to the class name", () => {
    expect(getLocalizationResourceName(TestResource)).toBe("Test");
    expect(getLocalizationResourceName(UnnamedResource)).toBe("UnnamedResource");
  });
});

describe("JsonLocalizationDictionaryBuilder", () => {
  it("flattens nested texts with __ and accepts case-insensitive property names", () => {
    const dictionary = JsonLocalizationDictionaryBuilder.buildFromObject({ Culture: "en", Texts: { A: { B: "ab", C: ["c0", "c1"] }, N: null, X: 5 } })!;
    expect(dictionary.cultureName).toBe("en");
    expect(dictionary.getOrNull("A__B")?.value).toBe("ab");
    expect(dictionary.getOrNull("A__C__1")?.value).toBe("c1");
    expect(dictionary.getOrNull("N")?.value).toBe("");
    expect(dictionary.getOrNull("X")?.value).toBe("5");
  });

  it("rejects invalid json and documents without culture", () => {
    expect(() => JsonLocalizationDictionaryBuilder.buildFromJsonString("{oops")).toThrow(/Can not parse json string/);
    expect(JsonLocalizationDictionaryBuilder.buildFromObject({ texts: {} })).toBeUndefined();
  });
});

describe("AbpStringLocalizerFactory / AbpDictionaryBasedStringLocalizer", () => {
  const factory = createFactory(configureTestResources);
  const L = factory.create(TestResource);

  it("loads every json file of a directory and merges files of the same culture", async () => {
    expect(L.withCulture("tr").t("Hello")).toBe("Merhaba");
    expect(L.withCulture("tr").t("Bye")).toBe("Güle güle");
    expect(L.withCulture("en").t("Menu__About")).toBe("About us");
    const tr = L.withCulture("tr").getAllStrings(false, false);
    expect(tr.map((s) => s.name).sort()).toEqual(["Bye", "Hello", "Welcome"]);
  });

  it("falls back specific culture -> base culture -> default culture -> base resources", () => {
    const gb = L.withCulture("en-GB");
    expect(gb.get("Hello")).toEqual({ name: "Hello", value: "Hello (GB)", resourceNotFound: false });
    expect(gb.t("OnlyInEn")).toBe("Only in en");
    const trTR = L.withCulture("tr-TR");
    expect(trTR.t("Hello")).toBe("Merhaba");
    expect(trTR.t("OnlyInEn")).toBe("Only in en");
    expect(trTR.t("FromBase")).toBe("From base (tr)");
    expect(L.withCulture("fr").t("FromBase")).toBe("From base (en)");
    expect(L.withCulture("tr").t("Shared")).toBe("Shared from test");
    expect(L.withCulture("tr").get("Missing")).toEqual({ name: "Missing", value: "Missing", resourceNotFound: true });
  });

  it("honours tryToGetFromBaseCulture / tryToGetFromDefaultCulture", () => {
    const strict = createFactory((o) => {
      configureTestResources(o);
      o.tryToGetFromBaseCulture = false;
      o.tryToGetFromDefaultCulture = false;
    }).create(TestResource);
    expect(strict.withCulture("en-GB").get("OnlyInEn").resourceNotFound).toBe(true);
    expect(strict.withCulture("fr").get("Hello").resourceNotFound).toBe(true);
    expect(strict.withCulture("en-GB").t("Hello")).toBe("Hello (GB)");
  });

  it("formats {0} placeholders and uses the ambient UI culture", () => {
    expect(L.withCulture("tr").t("Welcome", "Ali")).toBe("Hoş geldin Ali!");
    expect(L.get("Welcome", "Ali").value).toBe("Welcome Ali!");
    CultureHelper.run("tr", () => {
      expect(L.t("Hello")).toBe("Merhaba");
      expect(L.t("Welcome", "Ayşe")).toBe("Hoş geldin Ayşe!");
    });
    using _ = CultureHelper.use("en-GB");
    expect(L.t("Hello")).toBe("Hello (GB)");
  });

  it("getAllStrings merges base localizers, parent cultures and the culture itself", () => {
    const all = L.withCulture("tr-TR").getAllStrings();
    const byName = new Map(all.map((s) => [s.name, s.value]));
    expect(byName.get("Hello")).toBe("Merhaba");
    expect(byName.get("OnlyInEn")).toBe("Only in en");
    expect(byName.get("FromBase")).toBe("From base (tr)");
    expect(byName.get("Shared")).toBe("Shared from test");
    const own = L.withCulture("tr-TR").getAllStrings(true, false);
    expect(own.some((s) => s.name === "FromBase")).toBe(false);
    const noParents = L.withCulture("tr-TR").getAllStrings(false, false);
    expect(noParents).toEqual([]);
  });

  it("caches localizers per resource and supports lookup by name and default", () => {
    expect(factory.create(TestResource)).toBe(factory.create(TestResource));
    expect(factory.createByResourceName("Test")).toBe(factory.create(TestResource));
    expect(factory.createByResourceNameOrNull("Nope")).toBeUndefined();
    expect(() => factory.createByResourceName("Nope")).toThrow(/Couldn't find a localizer/);
    expect(factory.createDefaultOrNull()).toBe(factory.create(TestResource));
    expect(factory.create(UnnamedResource).get("X")).toEqual({ name: "X", value: "X", resourceNotFound: true });
  });

  it("reports supported cultures", async () => {
    const localizer = factory.create(TestResource);
    expect(isAbpStringLocalizer(localizer)).toBe(true);
    if (!isAbpStringLocalizer(localizer)) return;
    expect((await localizer.getSupportedCulturesAsync()).sort()).toEqual(["en", "en-GB", "tr"]);
    expect((await localizer.withCulture("tr-TR").getAllStringsAsync()).map((s) => s.name)).toEqual(localizer.withCulture("tr-TR").getAllStrings().map((s) => s.name));
  });

  it("throws for a missing localization directory", () => {
    expect(() => createFactory((o) => o.resources.add(UnnamedResource).addJsonFilesFromDirectory(join(fixtures, "missing")))).toThrow(/Localization directory not found/);
  });
});

describe("LocalizableString integration", () => {
  const factory = createFactory(configureTestResources);

  it("localizes core LocalizableString and FixedLocalizableString through the factory", () => {
    expect(LocalizableString.create(TestResource, "Hello").localize(factory).value).toBe("Hello");
    expect(fixedString("Raw").localize().value).toBe("Raw");
    expect(CultureHelper.run("tr", () => new ResourceNameLocalizableString("Hello", "Test").localize(factory).value)).toBe("Merhaba");
    expect(new ResourceNameLocalizableString("Hello").localize(factory).value).toBe("Hello");
    expect(new ResourceNameLocalizableString("Hello", "Nope").localize(factory).value).toBe("Hello");
  });

  it("serializes and deserializes localizable strings", () => {
    const serializer: LocalizableStringSerializer = new LocalizableStringSerializer({ value: factory.abpLocalizationOptions });
    expect(serializer.serialize(LocalizableString.create(TestResource, "Hello"))).toBe("L:Test,Hello");
    expect(serializer.serialize(fixedString("x"))).toBe("F:x");
    expect(serializer.serialize(undefined)).toBeUndefined();
    const deserialized = serializer.deserialize("L:Test,Hello");
    expect(deserialized).toBeInstanceOf(LocalizableString);
    expect((deserialized as LocalizableString).resource).toBe(TestResource);
    expect(serializer.deserialize("L:Other,Hello")).toBeInstanceOf(ResourceNameLocalizableString);
    expect(serializer.deserialize("F:abc").localize(factory).value).toBe("abc");
    expect(serializer.deserialize("plain").localize(factory).value).toBe("plain");
    expect(() => serializer.deserialize("L:NoComma")).toThrow(/Invalid LocalizableString/);
  });
});

describe("AbpEnumLocalizer", () => {
  enum BookType {
    Undefined = 0,
    Science = 1,
  }
  it("tries Enum:Name.Value, Enum:Name.Member, Name.Value, Name.Member, Member", () => {
    const factory = createFactory((o) => {
      o.resources.add(TestResource, "en").addJson({ culture: "en", texts: { "Enum:BookType.Science": "Science books", "BookType.Undefined": "Not set" } });
      o.defaultResourceType = TestResource;
    });
    const localizer = new AbpEnumLocalizer(factory);
    expect(localizer.getString("BookType", BookType, BookType.Science)).toBe("Science books");
    expect(localizer.getString("BookType", BookType, BookType.Undefined)).toBe("Not set");
    expect(localizer.getString("BookType", BookType, 7)).toBe("7");
    expect(localizer.getString("BookType", BookType, BookType.Science, [undefined])).toBe("Science");
  });
});

describe("languages and settings", () => {
  it("LanguageInfo derives defaults and two-letter language", () => {
    const info = new LanguageInfo("en-GB");
    expect(info.uiCultureName).toBe("en-GB");
    expect(info.displayName).toBe("en-GB");
    expect(info.twoLetterISOLanguageName).toBe("en");
    const languages = [new LanguageInfo("en"), new LanguageInfo("en", "en-GB", "English (UK)")];
    expect(findByCulture(languages, "en", "en-GB")?.displayName).toBe("English (UK)");
    expect(findByCulture(languages, "en")?.displayName).toBe("en");
    expect(findByCulture(languages, "tr")).toBeUndefined();
  });

  it("parses language settings", () => {
    expect(parseLanguageSetting("en-US;en")).toEqual({ cultureName: "en-US", uiCultureName: "en" });
    expect(parseLanguageSetting("tr")).toEqual({ cultureName: "tr", uiCultureName: "tr" });
    expect(parseLanguageSetting("??;!!", "en")).toEqual({ cultureName: "en", uiCultureName: "en" });
  });

  it("options keep language maps", () => {
    const options = new AbpLocalizationOptions();
    options.addLanguagesMapOrUpdate("pkg", { name: "zh-Hans", value: "zh" }).addLanguagesMapOrUpdate("pkg", { name: "zh-Hans", value: "zh-cn" });
    expect(options.getLanguagesMap("pkg", "zh-Hans")).toBe("zh-cn");
    expect(options.getLanguagesMap("pkg", "en")).toBe("en");
    expect(options.getLanguageFilesMap("other", "en")).toBe("en");
  });
});

@DependsOn(AbpLocalizationModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      configureTestResources(options);
      options.languages.push(new LanguageInfo("en"), new LanguageInfo("tr"));
    });
  }
}

describe("AbpLocalizationModule", () => {
  it("registers the factory, the default resources and per-resource localizer tokens", async () => {
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const factory = app.serviceProvider.getRequired(IStringLocalizerFactory);
    expect(factory).toBeInstanceOf(AbpStringLocalizerFactory);
    expect(app.serviceProvider.getAll(IStringLocalizerFactory)).toHaveLength(1);
    expect(factory.create(AbpLocalizationResource).t("DisplayName:Abp.Localization.DefaultLanguage")).toBe("Default language");
    expect(factory.createByResourceName("Default")).toBe(factory.create(DefaultResource));
    expect(app.serviceProvider.getRequired(stringLocalizerToken(TestResource)).withCulture("tr").t("Hello")).toBe("Merhaba");
    expect(app.serviceProvider.getRequired(stringLocalizerToken(TestResource))).toBe(factory.create(TestResource));
    expect(app.serviceProvider.getRequired(ILanguageProvider)).toBeInstanceOf(DefaultLanguageProvider);
    expect((await app.serviceProvider.getRequired(ILanguageProvider).getLanguagesAsync()).map((l) => l.cultureName)).toEqual(["en", "tr"]);
    expect(app.serviceProvider.getRequired(IAbpEnumLocalizer)).toBeInstanceOf(AbpEnumLocalizer);
    expect(app.serviceProvider.getRequired(ILocalizableStringSerializer).serialize(LocalizableString.create(TestResource, "Hello"))).toBe("L:Test,Hello");
    await app.shutdown();
  });
});
