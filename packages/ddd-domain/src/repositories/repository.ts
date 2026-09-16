import { createToken, keyedToken, type AbstractClass, type ServiceToken } from "@abp/core";
import type { EntityKeyOf, IEntity } from "../entities/entity.js";
import type { EntityPredicate, IQueryable } from "./queryable.js";

/*
 * Ports of IReadOnlyBasicRepository / IBasicRepository / IReadOnlyRepository / IRepository. Only the keyed
 * (`<TEntity, TKey>`) variants exist: every default repository of this port needs a single `id` (DynamoDB items are
 * addressed by it). `CancellationToken` parameters became optional `AbortSignal`s. The overloads that take a
 * predicate in .NET (`GetListAsync(predicate)`, `FindAsync(predicate)`, …) keep their name and are distinguished by
 * the argument type.
 */

/** Port of the non-generic `IRepository` members + `IReadOnlyBasicRepository<TEntity, TKey>`. */
export interface IReadOnlyBasicRepository<TEntity extends IEntity<TKey>, TKey> {
  /** Undefined means "not decided" (the provider default is to track changes). */
  readonly isChangeTrackingEnabled: boolean | undefined;
  entityName: string | undefined;
  readonly providerName: string;
  readonly entityType: AbstractClass<TEntity>;

  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  getCount(signal?: AbortSignal): Promise<number>;
  getPagedList(skipCount: number, maxResultCount: number, sorting: string | null | undefined, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  /** Throws `EntityNotFoundException` when there is no entity with the given id. */
  get(id: TKey, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity>;
  find(id: TKey, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity | undefined>;
}

/** Port of `IBasicRepository<TEntity, TKey>`. `autoSave` flushes the unit of work immediately. */
export interface IBasicRepository<TEntity extends IEntity<TKey>, TKey> extends IReadOnlyBasicRepository<TEntity, TKey> {
  insert(entity: TEntity, autoSave?: boolean, signal?: AbortSignal): Promise<TEntity>;
  insertMany(entities: Iterable<TEntity>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  update(entity: TEntity, autoSave?: boolean, signal?: AbortSignal): Promise<TEntity>;
  updateMany(entities: Iterable<TEntity>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  delete(entity: TEntity, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  deleteMany(entities: Iterable<TEntity>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  /** Port of `DeleteAsync(TKey id)`. */
  deleteById(id: TKey, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  /** Port of `DeleteManyAsync(IEnumerable<TKey> ids)`. */
  deleteManyByIds(ids: Iterable<TKey>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
}

/** Port of `IReadOnlyRepository<TEntity, TKey>`: adds predicate queries and the query builder. */
export interface IReadOnlyRepository<TEntity extends IEntity<TKey>, TKey> extends IReadOnlyBasicRepository<TEntity, TKey> {
  /** Port of `GetQueryableAsync`: the data-filtered query over all entities. */
  getQueryable(): Promise<IQueryable<TEntity>>;
  /** Alias of {@link getQueryable}. */
  query(): Promise<IQueryable<TEntity>>;
  /** Port of `WithDetailsAsync` (no eager loading here; returns the same query). */
  withDetails(): Promise<IQueryable<TEntity>>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  getList(predicate: EntityPredicate<TEntity>, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  /** Port of `CountAsync(predicate?)` (`RepositoryAsyncExtensions`). */
  count(predicate?: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<number>;
  /** Port of `AnyAsync(predicate?)` (`RepositoryAsyncExtensions`). */
  any(predicate?: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<boolean>;
  /** Port of `FirstOrDefaultAsync(predicate?)` (ordered by id). */
  firstOrDefault(predicate?: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<TEntity | undefined>;
}

/** Port of `IRepository<TEntity, TKey>`. */
export interface IRepository<TEntity extends IEntity<TKey>, TKey> extends IReadOnlyRepository<TEntity, TKey>, IBasicRepository<TEntity, TKey> {
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  getList(predicate: EntityPredicate<TEntity>, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  find(id: TKey, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity | undefined>;
  /** Single entity matching the predicate (throws when several match, like `SingleOrDefault`). */
  find(predicate: EntityPredicate<TEntity>, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity | undefined>;
  get(id: TKey, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity>;
  /** Throws `EntityNotFoundException` when nothing matches. */
  get(predicate: EntityPredicate<TEntity>, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity>;
  deleteMany(entities: Iterable<TEntity>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  /** Port of `DeleteAsync(predicate)`: loads and deletes (soft-delete/audit aware). */
  deleteMany(predicate: EntityPredicate<TEntity>, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  /** Port of `DeleteDirectAsync`: deletes without loading; soft delete and audit properties are bypassed where the provider can. */
  deleteDirect(predicate: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<void>;
}

/** Base token of the `IRepository<TEntity, TKey>` family: `repositoryToken(Book)` is `keyedToken(IRepository, Book)`. */
export const IRepository = createToken<unknown>("IRepository");

const entityTypesByToken = new Map<ServiceToken, AbstractClass>();

/** The service token of `IRepository<TEntity, TKey>` for an entity class (stable per class). */
export function repositoryToken<TEntity extends IEntity<TKey>, TKey = EntityKeyOf<TEntity>>(entityType: AbstractClass<TEntity>): ServiceToken<IRepository<TEntity, TKey>> {
  const token = keyedToken<IRepository<TEntity, TKey>>(IRepository, entityType);
  entityTypesByToken.set(token, entityType);
  return token;
}

/**
 * `IBasicRepository<TEntity, TKey>` resolves to the same registration as `IRepository<TEntity, TKey>` (ABP registers
 * the implementation under all four interfaces); the token is the same, only the static type is narrower.
 */
export function basicRepositoryToken<TEntity extends IEntity<TKey>, TKey = EntityKeyOf<TEntity>>(entityType: AbstractClass<TEntity>): ServiceToken<IBasicRepository<TEntity, TKey>> {
  return repositoryToken<TEntity, TKey>(entityType);
}

/** See {@link basicRepositoryToken}. */
export function readOnlyRepositoryToken<TEntity extends IEntity<TKey>, TKey = EntityKeyOf<TEntity>>(entityType: AbstractClass<TEntity>): ServiceToken<IReadOnlyRepository<TEntity, TKey>> {
  return repositoryToken<TEntity, TKey>(entityType);
}

/** Reverse lookup used by fallback resolvers: the entity class of a repository token, if it is one. */
export function entityTypeOfRepositoryToken(key: unknown): AbstractClass | undefined {
  return typeof key === "symbol" ? entityTypesByToken.get(key as ServiceToken) : undefined;
}

export function isRepository(value: unknown): value is IReadOnlyBasicRepository<IEntity<unknown>, unknown> {
  return typeof value === "object" && value !== null && typeof (value as IReadOnlyBasicRepository<IEntity<unknown>, unknown>).providerName === "string" && typeof (value as IReadOnlyBasicRepository<IEntity<unknown>, unknown>).getList === "function";
}

/** Port of `UnitOfWorkItemNames`. */
export const UnitOfWorkItemNames = {
  HardDeletedEntities: "AbpHardDeletedEntities",
} as const;
