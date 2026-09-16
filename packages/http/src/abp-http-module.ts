import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpJsonModule } from "@abp/json";
import { AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpExceptionHandlingResource, abpExceptionHandlingEn } from "./exception-handling/abp-exception-handling-resource.js";
import { AbpRemoteServiceOptions, bindRemoteServicesFromConfiguration } from "./remote-services/remote-service-configuration.js";
import "./exception-handling/exception-to-error-info-converter.js";
import "./exception-handling/http-exception-status-code-finder.js";

/** Port of `AbpHttpAbstractionsModule`. */
export class AbpHttpAbstractionsModule extends AbpModule {}

/**
 * Port of `AbpHttpModule` (no proxy scripting / minification). It also carries the `AbpExceptionHandlingModule`
 * responsibilities (the `AbpExceptionHandling` localization resource), which is why it depends on localization.
 */
@DependsOn(AbpHttpAbstractionsModule, AbpJsonModule, AbpLocalizationModule)
export class AbpHttpModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpExceptionHandlingResource, "en").addJson(abpExceptionHandlingEn);
    });
  }
}

/** Port of `AbpRemoteServicesModule`: binds `AbpRemoteServiceOptions` from the `RemoteServices` configuration section. */
@DependsOn(AbpMultiTenancyAbstractionsModule)
export class AbpRemoteServicesModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    if (!configuration) return;
    this.configure(AbpRemoteServiceOptions, (options) => bindRemoteServicesFromConfiguration(configuration, options));
  }
}
