import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuthorizationAbstractionsModule } from "@abp/authorization";
import { AbpExceptionLocalizationOptions, AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { GlobalFeatureInterceptorRegistrar } from "./global-feature-interceptor.js";
import { AbpGlobalFeatureResource, abpGlobalFeatureEn } from "./localization/abp-global-feature-resource.js";

/** Port of `AbpGlobalFeaturesModule` (the virtual file system dependency has no equivalent here). */
@DependsOn(AbpLocalizationModule, AbpAuthorizationAbstractionsModule)
export class AbpGlobalFeaturesModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(GlobalFeatureInterceptorRegistrar.registerIfNeeded);
  }

  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpGlobalFeatureResource, "en").addJson(abpGlobalFeatureEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.GlobalFeature", AbpGlobalFeatureResource);
    });
  }
}
