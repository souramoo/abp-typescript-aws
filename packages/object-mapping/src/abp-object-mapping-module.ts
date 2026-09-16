import { AbpModule, type ServiceConfigurationContext } from "@abp/core";
import { AbpObjectMappingOptions } from "./mapping-profile.js";
import { ProfileAutoObjectMappingProvider } from "./auto-object-mapping-provider.js";
import { DefaultObjectMapper } from "./default-object-mapper.js";
import { autoObjectMappingProviderToken, objectMapperToken } from "./object-mapper.js";

/**
 * Port of `AbpObjectMappingModule`. Registers `IObjectMapper` → `DefaultObjectMapper` and, for every context
 * declared in `AbpObjectMappingOptions` (via `addProfile(profile, context)` / `addContext`) during
 * `configureServices`, the `IObjectMapper<TContext>` pair of tokens; the runtime has no open generics.
 */
export class AbpObjectMappingModule extends AbpModule {
  override postConfigureServices(context: ServiceConfigurationContext): void {
    const options = context.services.options.build(AbpObjectMappingOptions);
    for (const mappingContext of options.contexts) {
      context.services.tryAddSingleton(autoObjectMappingProviderToken(mappingContext), { useFactory: (p) => new ProfileAutoObjectMappingProvider(p, mappingContext) });
      context.services.tryAddTransient(objectMapperToken(mappingContext), { useFactory: (p) => new DefaultObjectMapper(p, p.getRequired(autoObjectMappingProviderToken(mappingContext))) });
    }
  }
}
