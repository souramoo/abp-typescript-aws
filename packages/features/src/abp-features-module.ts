import { AbpModule, DependsOn, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuthorizationAbstractionsModule } from "@abp/authorization";
import { AbpExceptionLocalizationOptions, AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpValidationModule } from "@abp/validation";
import { AbpFeatureOptions } from "./abp-feature-options.js";
import { IFeatureDefinitionProvider } from "./feature-definition.js";
import { FeatureInterceptorRegistrar } from "./feature-interceptor.js";
import { ConfigurationFeatureValueProvider, DefaultValueFeatureValueProvider, EditionFeatureValueProvider, TenantFeatureValueProvider } from "./feature-value-provider.js";
import { AbpFeatureResource, abpFeatureEn } from "./localization/abp-feature-resource.js";

/** Port of `AbpFeaturesModule`. */
@DependsOn(AbpLocalizationModule, AbpMultiTenancyModule, AbpValidationModule, AbpAuthorizationAbstractionsModule)
export class AbpFeaturesModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(FeatureInterceptorRegistrar.registerIfNeeded);
    autoAddDefinitionProviders(context.services);
  }

  override configureServices(): void {
    this.configure(AbpFeatureOptions, (options) => {
      options.valueProviders.add(DefaultValueFeatureValueProvider);
      options.valueProviders.add(ConfigurationFeatureValueProvider);
      options.valueProviders.add(EditionFeatureValueProvider);
      options.valueProviders.add(TenantFeatureValueProvider);
    });

    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpFeatureResource, "en").addJson(abpFeatureEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.Feature", AbpFeatureResource);
    });
  }
}

function autoAddDefinitionProviders(services: ServiceCollection): void {
  const definitionProviders: Class<IFeatureDefinitionProvider>[] = [];
  services.onRegistered((context) => {
    if (IFeatureDefinitionProvider.has(context.implementationType)) definitionProviders.push(context.implementationType as Class<IFeatureDefinitionProvider>);
  });
  services.options.configure(AbpFeatureOptions, (options) => {
    options.definitionProviders.addRange(definitionProviders);
  });
}
