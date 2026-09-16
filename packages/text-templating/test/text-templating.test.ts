import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, CultureHelper, DependsOn, NullLoggerFactory, Transient } from "@abp/core";
import { AbpLocalizationOptions, LocalizationResourceName } from "@abp/localization";
import {
  AbpTextTemplatingModule,
  AbpTextTemplatingOptions,
  ITemplateContentProvider,
  ITemplateDefinitionManager,
  ITemplateDefinitionProvider,
  ITemplateRenderer,
  MustacheLikeRenderingEngine,
  TemplateDefinition,
  TemplateDefinitionProvider,
  type ITemplateDefinitionContext,
} from "../src/index.js";

@LocalizationResourceName("TestTemplates")
class TestTemplatesResource {}

const templateDirectory = mkdtempSync(join(tmpdir(), "abp-templates-"));
mkdirSync(join(templateDirectory, "Files.Localized"));
writeFileSync(join(templateDirectory, "Files.Localized", "en.tpl"), "Hello from file ({{ abp_culture }})");
writeFileSync(join(templateDirectory, "Files.Localized", "tr.tpl"), "Dosyadan merhaba ({{ abp_culture }})");
writeFileSync(join(templateDirectory, "Files.Single.tpl"), "single: {{ model.value }}");
const explicitFile = join(templateDirectory, "explicit.tpl");
writeFileSync(explicitFile, "explicit {{ model.value }}");
afterAll(() => rmSync(templateDirectory, { recursive: true, force: true }));

@Transient()
class TestTemplateDefinitionProvider extends TemplateDefinitionProvider {
  define(context: ITemplateDefinitionContext): void {
    context.add(
      new TemplateDefinition("Test.Layout", { isLayout: true, isInlineLocalized: true }),
      new TemplateDefinition("Test.Welcome", { localizationResource: TestTemplatesResource, layout: "Test.Layout", defaultCultureName: "en" }),
      new TemplateDefinition("Test.NoDefault"),
      new TemplateDefinition("Test.Inline", { localizationResource: "TestTemplates", isInlineLocalized: true }).withProperty("custom", 42),
      new TemplateDefinition("Test.List", { isInlineLocalized: true }),
      new TemplateDefinition("Files.Localized", { defaultCultureName: "en" }),
      new TemplateDefinition("Files.Single", { isInlineLocalized: true }),
      new TemplateDefinition("Files.Explicit").withFilePath(explicitFile, true),
    );
  }
}

@DependsOn(AbpTextTemplatingModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(TestTemplatesResource, "en").addJson(
        { culture: "en", texts: { Welcome: "Welcome {0}!", Greeting: "Hello" } },
        { culture: "tr", texts: { Welcome: "Hoş geldin {0}!", Greeting: "Merhaba" } },
      );
    });
    this.configure(AbpTextTemplatingOptions, (options) => {
      options.fileTemplateRootPath = templateDirectory;
      options.contents.add("Test.Layout", undefined, '<html lang="{{abp_culture}}" dir="{{abp_dir}}"><body>{{{ content }}}</body></html>');
      options.contents.add("Test.Welcome", "en", "{{ L \"Welcome\" model.name }} / {{ L \"Greeting\" }}");
      options.contents.add("Test.Welcome", "tr", "TR: {{ L \"Welcome\" model.name }}");
      options.contents.add("Test.NoDefault", "en", "english only");
      options.contents.add("Test.Inline", undefined, "{{#if model.isAdmin}}admin{{else}}user{{/if}}:{{ model.name | upcase }}{{! a comment }}");
      options.contents.add("Test.List", undefined, "{{#each model.items}}{{@index}}={{ name }}{{#if @last}}.{{else}},{{/if}}{{/each}}{{#each model.none}}x{{else}}empty{{/each}}");
    });
  }
}

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("text templating", () => {
  it("collects definitions from providers and exposes them through the manager", async () => {
    const app = await createApp();
    expect(ITemplateDefinitionProvider.has(TestTemplateDefinitionProvider)).toBe(true);
    const manager = app.serviceProvider.getRequired(ITemplateDefinitionManager);
    const welcome = await manager.get("Test.Welcome");
    expect(welcome.layout).toBe("Test.Layout");
    expect(welcome.localizationResourceName).toBe("TestTemplates");
    expect((await manager.get("Test.Inline")).getProperty("custom")).toBe(42);
    expect((await manager.getAll()).map((d) => d.name)).toContain("Test.Layout");
    expect(await manager.getOrNull("Missing")).toBeUndefined();
    await expect(manager.get("Missing")).rejects.toThrow("Undefined Template: Missing");
  });

  it("falls back from the requested culture to the base culture, then to the default culture", async () => {
    const app = await createApp();
    const provider = app.serviceProvider.getRequired(ITemplateContentProvider);
    expect(await provider.getContentOrNull("Test.Welcome", "tr-TR")).toBe("TR: {{ L \"Welcome\" model.name }}");
    expect(await provider.getContentOrNull("Test.Welcome", "de-DE")).toContain("{{ L \"Welcome\" model.name }} /");
    expect(await provider.getContentOrNull("Test.Welcome", "de-DE", false)).toBeUndefined();
    expect(await provider.getContentOrNull("Test.NoDefault", "en-GB")).toBe("english only");
    expect(await provider.getContentOrNull("Test.NoDefault", "fr")).toBeUndefined();
    expect(await provider.getContentOrNull("Test.Inline", "fr")).toContain("{{#if model.isAdmin}}");
    expect(await CultureHelper.run("tr", () => provider.getContentOrNull("Test.Welcome"))).toContain("TR:");
  });

  it("renders a template with model, localization and layout in the requested culture", async () => {
    const app = await createApp();
    const renderer = app.serviceProvider.getRequired(ITemplateRenderer);
    const en = await renderer.render("Test.Welcome", { name: "John" }, "en");
    expect(en).toBe('<html lang="en" dir="ltr"><body>Welcome John! / Hello</body></html>');
    const tr = await renderer.render("Test.Welcome", { name: "Ayşe" }, "tr");
    expect(tr).toBe('<html lang="tr" dir="ltr"><body>TR: Hoş geldin Ayşe!</body></html>');
    const ar = await CultureHelper.run("ar", () => renderer.render("Test.Welcome", { name: "X" }));
    expect(ar).toContain('dir="rtl"');
  });

  it("supports if/else, each with loop metadata, filters and comments", async () => {
    const app = await createApp();
    const renderer = app.serviceProvider.getRequired(ITemplateRenderer);
    expect(await renderer.render("Test.Inline", { isAdmin: true, name: "root" })).toBe("admin:ROOT");
    expect(await renderer.render("Test.Inline", { isAdmin: false, name: "guest" })).toBe("user:GUEST");
    expect(await renderer.render("Test.List", { items: [{ name: "a" }, { name: "b" }] })).toBe("0=a,1=b.empty");
  });

  it("reads templates from a directory of {name}/{culture}.tpl files, single files and explicit paths", async () => {
    const app = await createApp();
    const renderer = app.serviceProvider.getRequired(ITemplateRenderer);
    expect(await renderer.render("Files.Localized", undefined, "tr")).toBe("Dosyadan merhaba (tr)");
    expect(await renderer.render("Files.Localized", undefined, "de")).toBe("Hello from file (de)");
    expect(await renderer.render("Files.Single", { value: 1 })).toBe("single: 1");
    expect(await renderer.render("Files.Explicit", { value: 2 })).toBe("explicit 2");
  });

  it("keeps property access sandboxed and reports template syntax errors", () => {
    expect(() => MustacheLikeRenderingEngine.parse("{{#if x}}open")).toThrow("Unclosed");
    expect(() => MustacheLikeRenderingEngine.parse("{{/each}}")).toThrow("Unexpected");
    expect(() => MustacheLikeRenderingEngine.parse("{{ model.constructor }}")).toThrow("Invalid template expression");
  });
});
