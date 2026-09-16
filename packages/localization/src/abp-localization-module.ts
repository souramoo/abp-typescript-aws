import { AbpModule, IStringLocalizerFactory, type ServiceConfigurationContext } from "@abp/core";
import { AbpLocalizationOptions } from "./abp-localization-options.js";
import { AbpStringLocalizerFactory, stringLocalizerToken } from "./abp-string-localizer-factory.js";
import { isTypedResource } from "./localization-resource.js";
import { abpLocalizationEn, AbpLocalizationResource } from "./resources/abp-localization-resource.js";
import { DefaultResource } from "./resources/default-resource.js";

/**
 * Port of `AbpLocalizationModule`. `AbpStringLocalizerFactory` replaces `IStringLocalizerFactory` through its
 * conventional registration; `postConfigureServices` registers an `IStringLocalizer<TResource>` token per typed
 * resource (ABP's open generic registration), so resources added in a later `postConfigureServices` get none.
 */
export class AbpLocalizationModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addType(AbpStringLocalizerFactory);
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(DefaultResource, "en");
      options.resources.add(AbpLocalizationResource, "en").addJson(abpLocalizationEn);
    });
  }

  override postConfigureServices(context: ServiceConfigurationContext): void {
    const configured = context.services.options.build(AbpLocalizationOptions);
    for (const resource of configured.resources.values()) {
      if (!isTypedResource(resource)) continue;
      const type = resource.resourceType;
      context.services.tryAddTransient(stringLocalizerToken(type), { useFactory: (p) => p.getRequired(IStringLocalizerFactory).create(type) });
    }
  }
}
