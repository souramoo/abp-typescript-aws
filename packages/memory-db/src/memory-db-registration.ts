import { AbpException, type AbstractClass, type Class, type ServiceCollection } from "@abp/core";
import { AbpCommonDbContextRegistrationOptions, BasicAggregateRoot, BasicAggregateRootBase, RepositoryRegistrarBase, type AnyRepository } from "@abp/ddd-domain";
import type { MemoryDbContext } from "./memory-db-context.js";
import { memoryDbRepositoryClassFor } from "./memory-db-repository.js";

/** Port of `AbpMemoryDbContextRegistrationOptions` / `IAbpMemoryDbContextRegistrationOptionsBuilder`. */
export class AbpMemoryDbContextRegistrationOptions extends AbpCommonDbContextRegistrationOptions {
  readonly replacedDbContextTypes = new Map<AbstractClass, Class<MemoryDbContext> | undefined>();

  constructor(originalDbContextType: Class<MemoryDbContext>, services: ServiceCollection) {
    super(originalDbContextType, services);
  }

  /** Port of `ReplaceDbContext`: resolving `otherDbContextType` yields this (or the target) context. */
  replaceDbContext(otherDbContextType: AbstractClass, targetDbContextType?: Class<MemoryDbContext>): this {
    if (!(this.originalDbContextType.prototype instanceof otherDbContextType) && this.originalDbContextType !== otherDbContextType) {
      throw new AbpException(`${this.originalDbContextType.name} should inherit/implement ${otherDbContextType.name}!`);
    }
    this.replacedDbContextTypes.set(otherDbContextType, targetDbContextType);
    return this;
  }
}

/** Port of `MemoryDbRepositoryRegistrar`. */
export class MemoryDbRepositoryRegistrar extends RepositoryRegistrarBase<AbpMemoryDbContextRegistrationOptions> {
  constructor(options: AbpMemoryDbContextRegistrationOptions) {
    super(options);
  }

  protected getEntityTypes(dbContextType: AbstractClass): readonly AbstractClass[] {
    const dbContext = new (dbContextType as Class<MemoryDbContext>)();
    return dbContext.getEntityTypes();
  }

  protected getRepositoryType(dbContextType: AbstractClass, entityType: AbstractClass): Class<AnyRepository> {
    return memoryDbRepositoryClassFor(dbContextType as Class<MemoryDbContext>, entityType as AbstractClass<never>) as unknown as Class<AnyRepository>;
  }

  protected isAggregateRoot(entityType: AbstractClass): boolean {
    const prototype = entityType.prototype as object;
    return prototype instanceof BasicAggregateRoot || prototype instanceof BasicAggregateRootBase || (prototype as { __aggregateRoot?: unknown }).__aggregateRoot === true;
  }
}

/**
 * Port of `AbpMemoryDbServiceCollectionExtensions.AddMemoryDbContext`:
 * `addMemoryDbContext(services, MyDbContext, o => o.addDefaultRepositories().addRepository(Book, BookRepository))`.
 */
export function addMemoryDbContext<TDbContext extends MemoryDbContext>(services: ServiceCollection, dbContextType: Class<TDbContext>, optionsBuilder?: (options: AbpMemoryDbContextRegistrationOptions) => void): ServiceCollection {
  const options = new AbpMemoryDbContextRegistrationOptions(dbContextType, services);
  optionsBuilder?.(options);

  services.tryAddSingleton(dbContextType);
  if (options.defaultRepositoryDbContextType !== dbContextType) {
    services.tryAddSingleton(options.defaultRepositoryDbContextType as Class<MemoryDbContext>, { useFactory: (p) => p.getRequired(dbContextType) });
  }
  for (const [originalDbContextType, targetDbContextType] of options.replacedDbContextTypes) {
    const target = targetDbContextType ?? dbContextType;
    services.replaceSingleton(originalDbContextType as Class<MemoryDbContext>, { useFactory: (p) => p.getRequired(target) });
  }

  new MemoryDbRepositoryRegistrar(options).addRepositories();
  return services;
}
