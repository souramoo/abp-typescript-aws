import { type Class, type IServiceProvider, Check, IServiceProviderToken, Transient } from "@abp/core";
import { IAutoObjectMappingProvider, IObjectMapper, hasMapFrom, isMapTo, specificObjectMapperToken } from "./object-mapper.js";

/**
 * Port of `DefaultObjectMapper`. Resolution order (as in .NET): a specific mapper registered under
 * `specificObjectMapperToken(S, D)`, then `IMapTo` on the source, then `IMapFrom` on the destination, then the
 * `IAutoObjectMappingProvider`. A null/undefined source throws instead of returning null (the types exclude it).
 */
@Transient(IObjectMapper)
export class DefaultObjectMapper implements IObjectMapper {
  static readonly inject = [IServiceProviderToken, IAutoObjectMappingProvider] as const;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    readonly autoObjectMappingProvider: IAutoObjectMappingProvider,
  ) {}

  map<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource): TDestination {
    Check.notNull(source, "source");
    const specificMapper = this.serviceProvider.get(specificObjectMapperToken(sourceType, destinationType));
    if (specificMapper) return specificMapper.map(source);
    if (isMapTo<TDestination>(source)) return source.mapTo();
    if (hasMapFrom<TSource, TDestination>(destinationType)) {
      const destination = new destinationType();
      destination.mapFrom(source);
      return destination;
    }
    return this.autoMap(sourceType, destinationType, source);
  }

  mapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource, destination: TDestination): TDestination {
    Check.notNull(source, "source");
    const specificMapper = this.serviceProvider.get(specificObjectMapperToken(sourceType, destinationType));
    if (specificMapper) return specificMapper.mapTo(source, destination);
    if (isMapTo<TDestination>(source)) {
      source.mapTo(destination);
      return destination;
    }
    if (hasMapFrom<TSource, TDestination>(destinationType) && destination instanceof destinationType) {
      destination.mapFrom(source);
      return destination;
    }
    return this.autoMapTo(sourceType, destinationType, source, destination);
  }

  mapList<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, sources: readonly TSource[]): TDestination[] {
    return sources.map((source) => this.map(sourceType, destinationType, source));
  }

  protected autoMap<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource): TDestination {
    return this.autoObjectMappingProvider.map(sourceType, destinationType, source);
  }

  protected autoMapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource, destination: TDestination): TDestination {
    return this.autoObjectMappingProvider.mapTo(sourceType, destinationType, source, destination);
  }
}
