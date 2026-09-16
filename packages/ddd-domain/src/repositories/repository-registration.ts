import { AbpException, IServiceProviderToken, ServiceLifetime, type AbstractClass, type Class, type IServiceProvider, type ServiceCollection, type ServiceToken } from "@abp/core";
import { UnitOfWorkEnabled } from "@abp/uow";
import type { IEntity } from "../entities/entity.js";
import { EntityHelper } from "../entities/entity-helper.js";
import { entityTypeOfRepositoryToken, repositoryToken, type IReadOnlyBasicRepository } from "./repository.js";

/** A repository of any entity, as db modules see it when registering implementations. */
export type AnyRepository = IReadOnlyBasicRepository<IEntity<unknown>, unknown>;

/**
 * How a repository is created: a class with `static inject`, or a factory. A factory is wrapped in a unit-of-work
 * enabled class so its repository gets the lazy service provider and the interceptors like a class registration.
 */
export type RepositoryImplementation = Class<AnyRepository> | ((provider: IServiceProvider) => AnyRepository);

/** Asks a db provider for the default repository of an entity; undefined when the provider does not own the entity. */
export type DefaultRepositoryProvider = (entityType: AbstractClass) => RepositoryImplementation | undefined;

/**
 * Per service-collection registry behind the repository fallback resolver (installed by `AbpDddDomainModule`).
 * Db modules add a {@link DefaultRepositoryProvider}; `repositoryToken(Entity)` then resolves on first use even
 * when nobody registered it explicitly (port of the open-generic `IRepository<>` registrations).
 */
export class DefaultRepositoryRegistry {
  readonly providers: DefaultRepositoryProvider[] = [];
}

/** Port of `IRepositoryRegistrar`-style shape used by db modules (`AbpCommonDbContextRegistrationOptions` subset). */
export interface IRepositoryRegistrar {
  readonly services: ServiceCollection;
  /** Registers `repositoryToken(entityType)` (transient); `replaceExisting` replaces an earlier registration. */
  registerDefaultRepository(entityType: AbstractClass, implementation: RepositoryImplementation, replaceExisting?: boolean): void;
  /** Adds a lazy provider consulted by the fallback resolver for unregistered entities. */
  addDefaultRepositoryProvider(provider: DefaultRepositoryProvider): void;
}

function toImplementation(implementation: RepositoryImplementation): Class<AnyRepository> {
  if (isClass(implementation)) return implementation;
  const factory = implementation;
  class FactoryRepository {
    static readonly inject = [IServiceProviderToken] as const;
    constructor(provider: IServiceProvider) {
      return factory(provider) as unknown as FactoryRepository;
    }
  }
  UnitOfWorkEnabled.mark(FactoryRepository);
  return FactoryRepository as unknown as Class<AnyRepository>;
}

function isClass(value: RepositoryImplementation): value is Class<AnyRepository> {
  return /^class\s/.test(Function.prototype.toString.call(value));
}

/**
 * Port of `ServiceCollectionRepositoryExtensions.AddDefaultRepository`: registers the implementation for the entity
 * (one token serves `IRepository`, `IBasicRepository`, `IReadOnlyRepository` and `IReadOnlyBasicRepository`).
 */
export function registerDefaultRepository(services: ServiceCollection, entityType: AbstractClass, implementation: RepositoryImplementation, replaceExisting = false): ServiceCollection {
  EntityHelper.checkEntity(entityType);
  const token = repositoryToken(entityType as AbstractClass<IEntity<unknown>>) as ServiceToken<unknown>;
  const impl = toImplementation(implementation);
  if (replaceExisting) services.replace(token, impl, ServiceLifetime.Transient);
  else services.tryAdd(token, impl, ServiceLifetime.Transient);
  return services;
}

/** Alias of {@link registerDefaultRepository} named after the .NET extension method. */
export const addDefaultRepository = registerDefaultRepository;

const registries = new WeakMap<ServiceCollection, DefaultRepositoryRegistry>();

export function getDefaultRepositoryRegistry(services: ServiceCollection): DefaultRepositoryRegistry {
  let registry = registries.get(services);
  if (!registry) {
    registry = new DefaultRepositoryRegistry();
    registries.set(services, registry);
  }
  return registry;
}

export function addDefaultRepositoryProvider(services: ServiceCollection, provider: DefaultRepositoryProvider): ServiceCollection {
  getDefaultRepositoryRegistry(services).providers.push(provider);
  return services;
}

/** Creates the registrar shape over a service collection (what db-context registration options build on). */
export function createRepositoryRegistrar(services: ServiceCollection): IRepositoryRegistrar {
  return {
    services,
    registerDefaultRepository: (entityType, implementation, replaceExisting) => {
      registerDefaultRepository(services, entityType, implementation, replaceExisting);
    },
    addDefaultRepositoryProvider: (provider) => {
      addDefaultRepositoryProvider(services, provider);
    },
  };
}

/**
 * Installs the fallback resolver for repository tokens (done by `AbpDddDomainModule`). Resolution order: explicit
 * registrations always win (the resolver only runs for unknown keys); then providers in registration order.
 */
export function installRepositoryFallbackResolver(services: ServiceCollection): void {
  services.addFallbackResolver((key) => {
    const entityType = entityTypeOfRepositoryToken(key);
    if (!entityType) return undefined;
    for (const provider of getDefaultRepositoryRegistry(services).providers) {
      const implementation = provider(entityType);
      if (implementation) return { lifetime: ServiceLifetime.Transient, implementation: toImplementation(implementation) };
    }
    return undefined;
  });
}

/**
 * Port of `AbpCommonDbContextRegistrationOptions` (the parts that survive without reflection). Db modules extend it
 * and drive a `RepositoryRegistrarBase`.
 */
export abstract class AbpCommonDbContextRegistrationOptions {
  readonly customRepositories = new Map<AbstractClass, Class<AnyRepository>>();
  readonly specifiedDefaultRepositories: AbstractClass[] = [];
  registerDefaultRepositories = false;
  includeAllEntitiesForDefaultRepositories = false;
  defaultRepositoryDbContextType: AbstractClass;

  protected constructor(
    readonly originalDbContextType: AbstractClass,
    readonly services: ServiceCollection,
  ) {
    this.defaultRepositoryDbContextType = originalDbContextType;
  }

  /** Registers default repositories for the aggregate roots (or all entities) of the db context. */
  addDefaultRepositories(includeAllEntities = false): this {
    this.registerDefaultRepositories = true;
    this.includeAllEntitiesForDefaultRepositories = includeAllEntities;
    return this;
  }

  /** Registers the default repository for one specific entity of the db context. */
  addDefaultRepository(entityType: AbstractClass): this {
    EntityHelper.checkEntity(entityType);
    if (!this.specifiedDefaultRepositories.includes(entityType)) this.specifiedDefaultRepositories.push(entityType);
    return this;
  }

  /** Registers a custom repository class for an entity (overrides the default one). */
  addRepository(entityType: AbstractClass, repositoryType: Class<AnyRepository>): this {
    EntityHelper.checkEntity(entityType);
    if (typeof (repositoryType.prototype as { getList?: unknown }).getList !== "function") {
      throw new AbpException(`Given repositoryType is not a repository: ${repositoryType.name}. It must implement IBasicRepository.`);
    }
    this.customRepositories.set(entityType, repositoryType);
    return this;
  }
}

/** Port of `RepositoryRegistrarBase<TOptions>`. */
export abstract class RepositoryRegistrarBase<TOptions extends AbpCommonDbContextRegistrationOptions> {
  protected constructor(readonly options: TOptions) {}

  addRepositories(): void {
    this.registerCustomRepositories();
    this.registerDefaultRepositories();
    this.registerSpecifiedDefaultRepositories();
  }

  protected registerCustomRepositories(): void {
    for (const [entityType, repositoryType] of this.options.customRepositories) {
      registerDefaultRepository(this.options.services, entityType, repositoryType, true);
    }
  }

  protected registerDefaultRepositories(): void {
    if (!this.options.registerDefaultRepositories) return;
    for (const entityType of this.getEntityTypes(this.options.originalDbContextType)) {
      if (this.shouldRegisterDefaultRepositoryFor(entityType)) this.registerDefaultRepository(entityType);
    }
  }

  protected registerSpecifiedDefaultRepositories(): void {
    for (const entityType of this.options.specifiedDefaultRepositories) {
      if (!this.options.customRepositories.has(entityType)) this.registerDefaultRepository(entityType);
    }
  }

  protected registerDefaultRepository(entityType: AbstractClass): void {
    registerDefaultRepository(this.options.services, entityType, this.getRepositoryType(this.options.defaultRepositoryDbContextType, entityType));
  }

  protected shouldRegisterDefaultRepositoryFor(entityType: AbstractClass): boolean {
    if (!this.options.registerDefaultRepositories) return false;
    if (this.options.customRepositories.has(entityType)) return false;
    if (!this.options.includeAllEntitiesForDefaultRepositories && !this.isAggregateRoot(entityType)) return false;
    return true;
  }

  /** `IAggregateRoot` is erased: the check is by base class (`BasicAggregateRoot`/`AggregateRoot`) or a `__aggregateRoot` marker on the prototype. */
  protected abstract isAggregateRoot(entityType: AbstractClass): boolean;
  protected abstract getEntityTypes(dbContextType: AbstractClass): readonly AbstractClass[];
  protected abstract getRepositoryType(dbContextType: AbstractClass, entityType: AbstractClass): Class<AnyRepository>;
}
