import { type Class, type IServiceProvider, type ServiceToken, createToken, keyedToken } from "@abp/core";

/** Port of `IAutoObjectMappingProvider`: the pluggable backend used when no specific mapper handles a pair. */
export interface IAutoObjectMappingProvider {
  map<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource): TDestination;
  mapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource, destination: TDestination): TDestination;
}
export const IAutoObjectMappingProvider = createToken<IAutoObjectMappingProvider>("IAutoObjectMappingProvider");

/** `IAutoObjectMappingProvider<TContext>`. */
export function autoObjectMappingProviderToken(context: Class): ServiceToken<IAutoObjectMappingProvider> {
  return keyedToken<IAutoObjectMappingProvider>(IAutoObjectMappingProvider, context);
}

/**
 * Port of `IObjectMapper`. Generic type arguments of .NET become explicit class arguments because types are
 * erased at runtime; `mapList` replaces the `Map<List<TSource>, List<TDestination>>` collection support.
 */
export interface IObjectMapper {
  readonly autoObjectMappingProvider: IAutoObjectMappingProvider;
  /** Creates a new `TDestination` from `source`. */
  map<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource): TDestination;
  /** Maps `source` onto the existing `destination` and returns that same object. */
  mapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, source: TSource, destination: TDestination): TDestination;
  mapList<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, sources: readonly TSource[]): TDestination[];
}
export const IObjectMapper = createToken<IObjectMapper>("IObjectMapper");

/** `IObjectMapper<TContext>`: a mapper that also sees the profiles registered for `context` (usually a module class). */
export function objectMapperToken(context: Class): ServiceToken<IObjectMapper> {
  return keyedToken<IObjectMapper>(IObjectMapper, context);
}

/** Port of `IObjectMapper<TSource, TDestination>`: implement and register under `specificObjectMapperToken(S, D)`. */
export interface ISpecificObjectMapper<TSource, TDestination> {
  map(source: TSource): TDestination;
  mapTo(source: TSource, destination: TDestination): TDestination;
}
const ISpecificObjectMapperBase = createToken<unknown>("IObjectMapper<TSource, TDestination>");
export function specificObjectMapperToken<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>): ServiceToken<ISpecificObjectMapper<TSource, TDestination>> {
  return keyedToken<ISpecificObjectMapper<TSource, TDestination>>(keyedToken(ISpecificObjectMapperBase, sourceType), destinationType);
}

/** Port of `IMapTo<TDestination>`; detected by duck typing (`mapTo` method) since interfaces are erased. */
export interface IMapTo<TDestination> {
  mapTo(): TDestination;
  mapTo(destination: TDestination): void;
}
export function isMapTo<TDestination>(value: unknown): value is IMapTo<TDestination> {
  return typeof value === "object" && value !== null && typeof (value as IMapTo<TDestination>).mapTo === "function";
}

/** Port of `IMapFrom<TSource>`; the destination class needs a parameterless constructor. */
export interface IMapFrom<TSource> {
  mapFrom(source: TSource): void;
}
export function isMapFrom<TSource>(value: unknown): value is IMapFrom<TSource> {
  return typeof value === "object" && value !== null && typeof (value as IMapFrom<TSource>).mapFrom === "function";
}
export function hasMapFrom<TSource, TDestination>(destinationType: Class<TDestination>): destinationType is Class<TDestination & IMapFrom<TSource>> {
  return isMapFrom<TSource>(destinationType.prototype);
}

/** Passed to profile map functions so nested members can be mapped through the same mapper. */
export interface MappingContext {
  readonly mapper: IObjectMapper;
  readonly serviceProvider: IServiceProvider;
}

/**
 * Shallow member-wise copy (AutoMapper's default convention): every own enumerable, non-function property of
 * `source` is assigned onto `destination`. Used by `CrudAppService` for entity ↔ DTO updates.
 */
export function mapProperties<TDestination extends object>(source: object, destination: TDestination): TDestination {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "function") continue;
    Reflect.set(destination, key, value);
  }
  return destination;
}
