import { AbpModule, DependsOn, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { AbpLocalizationModule } from "@abp/localization";
import { AbpTextTemplatingOptions } from "./abp-text-templating-options.js";
import { MustacheLikeRenderingEngine } from "./mustache-like-rendering-engine.js";
import { ITemplateContentContributor } from "./template-content-contributor.js";
import { ITemplateDefinitionProvider } from "./template-definition-provider.js";
import "./file-template-content-contributor.js";
import "./in-memory-template-content-contributor.js";
import "./template-content-provider.js";
import "./template-definition-store.js";
import "./template-renderer.js";

/**
 * Port of `AbpTextTemplatingCoreModule`. The virtual file system dependency is replaced by the file and in-memory
 * content contributors of this package; providers and contributors are discovered through class markers.
 */
@DependsOn(AbpLocalizationModule)
export class AbpTextTemplatingCoreModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    autoAddProvidersAndContributors(context.services);
  }
}

function autoAddProvidersAndContributors(services: ServiceCollection): void {
  const definitionProviders: Class<ITemplateDefinitionProvider>[] = [];
  const contentContributors: Class<ITemplateContentContributor>[] = [];
  services.onRegistered((context) => {
    if (ITemplateDefinitionProvider.has(context.implementationType)) definitionProviders.push(context.implementationType as Class<ITemplateDefinitionProvider>);
    if (ITemplateContentContributor.has(context.implementationType)) contentContributors.push(context.implementationType as Class<ITemplateContentContributor>);
  });
  services.options.configure(AbpTextTemplatingOptions, (options) => {
    options.definitionProviders.addRange(definitionProviders);
    options.contentContributors.addRange(contentContributors);
  });
}

/**
 * Port of `AbpTextTemplatingScribanModule`: registers the built-in `MustacheLikeRenderingEngine` as the default
 * rendering engine (Scriban has no JavaScript counterpart).
 */
@DependsOn(AbpTextTemplatingCoreModule)
export class AbpTextTemplatingMustacheLikeModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpTextTemplatingOptions, (options) => {
      options.defaultRenderingEngine = MustacheLikeRenderingEngine.EngineName;
      options.renderingEngines.set(MustacheLikeRenderingEngine.EngineName, MustacheLikeRenderingEngine);
    });
  }
}

/** Port of `AbpTextTemplatingModule` (the .NET one depends on the Scriban module). */
@DependsOn(AbpTextTemplatingMustacheLikeModule)
export class AbpTextTemplatingModule extends AbpModule {}
