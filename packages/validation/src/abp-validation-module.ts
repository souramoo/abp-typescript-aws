import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpValidationOptions } from "./abp-validation-options.js";
import { abpValidationEn, AbpValidationResource } from "./localization/abp-validation-resource.js";
import { ValidationInterceptorRegistrar } from "./validation-interceptor.js";
import { ZodObjectValidationContributor } from "./zod-object-validation-contributor.js";

/**
 * Port of `AbpValidationModule`. ABP discovers `IObjectValidationContributor` implementations by interface;
 * here the built-in contributor is added explicitly and other modules add theirs through `AbpValidationOptions`.
 */
@DependsOn(AbpLocalizationModule)
export class AbpValidationModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(ValidationInterceptorRegistrar.registerIfNeeded);
  }

  override configureServices(): void {
    this.configure(AbpValidationOptions, (options) => {
      options.objectValidationContributors.add(ZodObjectValidationContributor);
    });
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpValidationResource, "en").addJson(abpValidationEn);
    });
  }
}
