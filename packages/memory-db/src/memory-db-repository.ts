import type { AbstractClass, Class } from "@abp/core";
import { ArrayQueryable, EntityHelper, RepositoryBase, isSoftDelete, keysEqual, type EntityKeyOf, type EntityPredicate, type IEntity, type IQueryable } from "@abp/ddd-domain";
import { AbpMemoryDbConsts, type MemoryDbContext } from "./memory-db-context.js";
import { memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "./memory-database-provider.js";
import type { IMemoryDatabase, IMemoryDatabaseCollection } from "./memory-database.js";

/** Port of `IMemoryDbRepository<TEntity, TKey>`. */
export interface IMemoryDbRepository<TEntity extends IEntity<TKey>, TKey> {
  getDatabase(): Promise<IMemoryDatabase>;
  getCollection(): Promise<IMemoryDatabaseCollection<TEntity>>;
}

/**
 * Port of `MemoryDbRepository<TMemoryDbContext, TEntity, TKey>`. Writes reach the collection immediately (the memory
 * database has no transactions), exactly like the .NET provider: a unit of work that is not completed still leaves
 * its inserts behind, only its events are dropped.
 */
export class MemoryDbRepository<TDbContext extends MemoryDbContext, TEntity extends IEntity<TKey>, TKey> extends RepositoryBase<TEntity, TKey> implements IMemoryDbRepository<TEntity, TKey> {
  constructor(
    protected readonly databaseProvider: IMemoryDatabaseProvider<TDbContext>,
    entityType: AbstractClass<TEntity>,
  ) {
    super(AbpMemoryDbConsts.ProviderName, entityType);
  }

  getDatabase(): Promise<IMemoryDatabase> {
    return this.databaseProvider.getDatabase();
  }

  async getCollection(): Promise<IMemoryDatabaseCollection<TEntity>> {
    return (await this.getDatabase()).collection(this.entityType);
  }

  /** The collection is captured now (a unit of work is required), every execution re-reads it like `AsQueryable()`. */
  async getQueryable(): Promise<IQueryable<TEntity>> {
    const collection = await this.getCollection();
    return this.applyDataFilters(ArrayQueryable.from(() => [...collection]));
  }

  async insert(entity: TEntity, _autoSave = false): Promise<TEntity> {
    await this.setIdIfNeeded(entity);
    this.applyAbpConceptsForAddedEntity(entity);
    (await this.getCollection()).add(entity);
    return entity;
  }

  async update(entity: TEntity, _autoSave = false): Promise<TEntity> {
    this.applyAbpConceptsForUpdatedEntity(entity);
    (await this.getCollection()).update(entity);
    return entity;
  }

  async delete(entity: TEntity, _autoSave = false): Promise<void> {
    this.applyAbpConceptsForDeletedEntity(entity);
    const collection = await this.getCollection();
    if (!this.shouldHardDelete(entity) && isSoftDelete(entity)) {
      entity.isDeleted = true;
      collection.update(entity);
      return;
    }
    collection.remove(entity);
  }

  async deleteDirect(predicate: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<void> {
    await this.deleteMany(predicate, true, signal);
  }

  protected override async findById(id: TKey, _includeDetails = true, signal?: AbortSignal): Promise<TEntity | undefined> {
    return (await this.getQueryable()).where((e) => keysEqual(e.id, id)).firstOrDefault(signal);
  }

  /** Numeric ids come from the database sequence, unset string ids become guids (`trySetGuidId` runs afterwards). */
  protected async setIdIfNeeded(entity: TEntity): Promise<void> {
    if (!EntityHelper.hasDefaultId(entity)) return;
    const id: unknown = entity.id;
    if (typeof id !== "number") return;
    const nextId = (await this.getDatabase()).generateNextId(this.entityType, "number");
    EntityHelper.trySetId(entity as IEntity<unknown>, () => nextId);
  }
}

export type MemoryDbRepositoryClass<TDbContext extends MemoryDbContext, TEntity extends IEntity<TKey>, TKey> = Class<MemoryDbRepository<TDbContext, TEntity, TKey>>;

const repositoryClasses = new WeakMap<object, Map<AbstractClass, Class>>();

/**
 * Port of `typeof(MemoryDbRepository<,,>).MakeGenericType(dbContext, entity, key)`: the closed repository class for a
 * context/entity pair, with `static inject` wired to the context's database provider. Cached per pair.
 */
export function memoryDbRepositoryClassFor<TDbContext extends MemoryDbContext, TEntity extends IEntity<TKey>, TKey = EntityKeyOf<TEntity>>(dbContextType: Class<TDbContext>, entityType: AbstractClass<TEntity>): MemoryDbRepositoryClass<TDbContext, TEntity, TKey> {
  let byEntity = repositoryClasses.get(dbContextType);
  if (!byEntity) {
    byEntity = new Map();
    repositoryClasses.set(dbContextType, byEntity);
  }
  const existing = byEntity.get(entityType);
  if (existing) return existing as MemoryDbRepositoryClass<TDbContext, TEntity, TKey>;

  const providerToken = memoryDatabaseProviderToken(dbContextType);
  const closed = class extends MemoryDbRepository<TDbContext, TEntity, TKey> {
    static readonly inject = [providerToken] as const;
    constructor(databaseProvider: IMemoryDatabaseProvider<TDbContext>) {
      super(databaseProvider, entityType);
    }
  };
  Object.defineProperty(closed, "name", { value: `MemoryDbRepository<${dbContextType.name}, ${entityType.name}>` });
  byEntity.set(entityType, closed);
  return closed;
}
