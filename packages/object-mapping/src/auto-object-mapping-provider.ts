import { AbpException, type Class, type IServiceProvider, IServiceProviderToken, Singleton } from "@abp/core";
import { IAutoObjectMappingProvider, IObjectMapper, type MappingContext, mapProperties, objectMapperToken } from "./object-mapper.js";
import { AbpObjectMappingOptions, MappingRegistry, noMappingFoundException } from "./mapping-profile.js";

/** Port of `NotImplementedAutoObjectMappingProvider`: the .NET default when no mapping library is installed. */
export class NotImplementedAutoObjectMappingProvider implements IAutoObjectMappingProvider {
  map<TSource, TDestination>(_sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource): TDestination {
    throw new AbpException(`Can not map from given object (${String(source)}) to ${destinationType.name}.`);
  }
  mapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>): TDestination {
    throw new AbpException(`Can not map from ${sourceType.name} to ${destinationType.name}.`);
  }
}

/**
 * Replaces `AutoMapperAutoObjectMappingProvider` / `MapperlyAutoObjectMappingProvider`: maps with the functions
 * declared in `MappingProfile`s registered through `AbpObjectMappingOptions`. Registered as the global provider and
 * created per context (`autoObjectMappingProviderToken(context)`) by `AbpObjectMappingModule`.
 */
@Singleton(IAutoObjectMappingProvider)
export class ProfileAutoObjectMappingProvider implements IAutoObjectMappingProvider {
  static readonly inject = [IServiceProviderToken] as const;
  private registryCache: MappingRegistry | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    readonly context?: Class,
  ) {}

  protected get registry(): MappingRegistry {
    if (!this.registryCache) this.registryCache = MappingRegistry.fromOptions(this.serviceProvider.getOptions(AbpObjectMappingOptions), this.context);
    return this.registryCache;
  }

  map<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource): TDestination {
    const definition = this.registry.find(sourceType, destinationType);
    if (definition?.map) return definition.map(source, this.mappingContext());
    if (definition?.mapTo) {
      const destination = new destinationType();
      definition.mapTo(source, destination, this.mappingContext());
      return destination;
    }
    throw noMappingFoundException(sourceType, destinationType);
  }

  mapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource, destination: TDestination): TDestination {
    const definition = this.registry.find(sourceType, destinationType);
    if (definition?.mapTo) {
      definition.mapTo(source, destination, this.mappingContext());
      return destination;
    }
    if (definition?.map && typeof destination === "object" && destination !== null) {
      const created = definition.map(source, this.mappingContext());
      if (typeof created === "object" && created !== null) return mapProperties(created, destination);
    }
    throw noMappingFoundException(sourceType, destinationType);
  }

  protected mappingContext(): MappingContext {
    return {
      mapper: this.serviceProvider.getRequired(this.context ? objectMapperToken(this.context) : IObjectMapper),
      serviceProvider: this.serviceProvider,
    };
  }
}
