import { type Class, TypeList, AbpException } from "@abp/core";
import type { MappingContext } from "./object-mapper.js";

export type MapFunction<TSource, TDestination> = (source: TSource, context: MappingContext) => TDestination;
export type MapToFunction<TSource, TDestination> = (source: TSource, destination: TDestination, context: MappingContext) => void;

export interface MapDefinition<TSource = unknown, TDestination = unknown> {
  readonly sourceType: Class<TSource>;
  readonly destinationType: Class<TDestination>;
  readonly map?: MapFunction<TSource, TDestination>;
  readonly mapTo?: MapToFunction<TSource, TDestination>;
}

/**
 * Type-erased storage: method syntax keeps parameters bivariant so typed definitions can be stored without
 * casts; `MappingRegistry.find` restores the pair's types from the class keys used at registration.
 */
interface ErasedMapDefinition {
  readonly sourceType: Class<unknown>;
  readonly destinationType: Class<unknown>;
  map?(source: unknown, context: MappingContext): unknown;
  mapTo?(source: unknown, destination: unknown, context: MappingContext): void;
}

/**
 * Port of an AutoMapper `Profile`: declare maps in the constructor with `createMap` / `createMapTo` and
 * register the class with `AbpObjectMappingOptions.addProfile`.
 */
export abstract class MappingProfile {
  private readonly definitions: ErasedMapDefinition[] = [];

  /** @internal */
  get _definitions(): readonly ErasedMapDefinition[] {
    return this.definitions;
  }

  /** `CreateMap<TSource, TDestination>()`: `map` builds a new destination; `mapTo` (optional) updates an existing one. */
  protected createMap<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, map: MapFunction<TSource, TDestination>, mapTo?: MapToFunction<TSource, TDestination>): this {
    this.definitions.push(mapTo ? { sourceType, destinationType, map, mapTo } : { sourceType, destinationType, map });
    return this;
  }

  /** Registers only the update-in-place direction for a pair. */
  protected createMapTo<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>, mapTo: MapToFunction<TSource, TDestination>): this {
    this.definitions.push({ sourceType, destinationType, mapTo });
    return this;
  }
}

export interface ProfileRegistration {
  readonly profileType: Class<MappingProfile>;
  /** Restricts the profile to `objectMapperToken(context)`; global when undefined. */
  readonly context: Class | undefined;
}

/** Port of `AbpAutoMapperOptions` for the explicit profile registry. */
export class AbpObjectMappingOptions {
  readonly profiles: ProfileRegistration[] = [];
  /** Contexts for which `objectMapperToken(context)` / `autoObjectMappingProviderToken(context)` are registered. */
  readonly contexts = new TypeList();

  addProfile(profileType: Class<MappingProfile>, context?: Class): this {
    this.profiles.push({ profileType, context });
    if (context) this.contexts.add(context);
    return this;
  }

  /** Makes `objectMapperToken(context)` resolvable even when no profile is bound to that context. */
  addContext(context: Class): this {
    this.contexts.add(context);
    return this;
  }
}

/** Lookup table built from profiles: `Map<Source, Map<Destination, definition>>`; later registrations win. */
export class MappingRegistry {
  private readonly maps = new Map<Class<unknown>, Map<Class<unknown>, ErasedMapDefinition>>();

  static fromOptions(options: AbpObjectMappingOptions, context?: Class): MappingRegistry {
    const registry = new MappingRegistry();
    const global = options.profiles.filter((p) => p.context === undefined);
    const contextual = context ? options.profiles.filter((p) => p.context === context) : [];
    for (const registration of [...global, ...contextual]) registry.addProfile(new registration.profileType());
    return registry;
  }

  addProfile(profile: MappingProfile): void {
    for (const definition of profile._definitions) {
      const existing = this.maps.get(definition.sourceType)?.get(definition.destinationType);
      this.set(existing ? { ...existing, ...definition } : definition);
    }
  }

  find<TSource, TDestination>(sourceType: Class<TSource>, destinationType: Class<TDestination>): MapDefinition<TSource, TDestination> | undefined {
    const erased = this.maps.get(sourceType)?.get(destinationType);
    if (!erased) return undefined;
    const definition: MapDefinition<unknown, unknown> = erased;
    // Safe: `erased` was stored under exactly this (sourceType, destinationType) pair by `createMap`.
    return definition as MapDefinition<TSource, TDestination>;
  }

  private set(definition: ErasedMapDefinition): void {
    let byDestination = this.maps.get(definition.sourceType);
    if (!byDestination) {
      byDestination = new Map();
      this.maps.set(definition.sourceType, byDestination);
    }
    byDestination.set(definition.destinationType, definition);
  }
}

export function noMappingFoundException(sourceType: Class<unknown>, destinationType: Class<unknown>): AbpException {
  return new AbpException(
    `No object mapping was found for the specified source and destination types.\n\nMapping attempted:\n${sourceType.name} -> ${destinationType.name}\n\nHow to fix:\nCreate a MappingProfile with createMap(${sourceType.name}, ${destinationType.name}, ...) and register it with AbpObjectMappingOptions.addProfile, or implement IMapTo/IMapFrom on the types.`,
  );
}
