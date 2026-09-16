import { DisposeAction, type ISoftDelete } from "@abp/core";
import { IDataFilter, SoftDeleteFilter } from "@abp/data";
import type { IUnitOfWorkManager} from "@abp/uow";
import { type IUnitOfWork } from "@abp/uow";
import type { IEntity, IEntityBase } from "../entities/entity.js";
import { EntityHelper } from "../entities/entity-helper.js";
import { EntityNotFoundException } from "../entities/entity-not-found-exception.js";
import type { EntityPredicate } from "./queryable.js";
import { BasicRepositoryBase } from "./repository-base.js";
import { UnitOfWorkItemNames, type IBasicRepository, type IReadOnlyBasicRepository, type IRepository } from "./repository.js";

/* Port of `RepositoryExtensions` as plain functions (interfaces cannot carry extension methods). */

/** Port of `EnsureCollectionLoadedAsync`: a no-op here, there is no lazy loading (kept for source compatibility). */
export async function ensureCollectionLoaded<TEntity extends IEntity<TKey>, TKey>(_repository: IBasicRepository<TEntity, TKey>, _entity: TEntity, _propertyName: keyof TEntity): Promise<void> {}

/** Port of `EnsurePropertyLoadedAsync`: a no-op here, there is no lazy loading (kept for source compatibility). */
export async function ensurePropertyLoaded<TEntity extends IEntity<TKey>, TKey>(_repository: IBasicRepository<TEntity, TKey>, _entity: TEntity, _propertyName: keyof TEntity): Promise<void> {}

/** Port of `EnsureExistsAsync(id)` / `EnsureExistsAsync(predicate)`. */
export async function ensureExists<TEntity extends IEntity<TKey>, TKey>(repository: IRepository<TEntity, TKey>, idOrPredicate: TKey | EntityPredicate<TEntity>, signal?: AbortSignal): Promise<void> {
  if (typeof idOrPredicate === "function" || (typeof idOrPredicate === "object" && idOrPredicate !== null && "toExpression" in idOrPredicate)) {
    if (!(await repository.any(idOrPredicate as EntityPredicate<TEntity>, signal))) throw new EntityNotFoundException(repository.entityType);
    return;
  }
  if (!(await repository.any(EntityHelper.createEqualityExpressionForId<TEntity, TKey>(idOrPredicate as TKey), signal))) throw new EntityNotFoundException(repository.entityType, idOrPredicate);
}

function unitOfWorkManagerOf(repository: object): IUnitOfWorkManager {
  if (repository instanceof BasicRepositoryBase) return repository.unitOfWorkManager;
  const accessor = repository as { unitOfWorkManager?: IUnitOfWorkManager };
  if (accessor.unitOfWorkManager) return accessor.unitOfWorkManager;
  throw new Error(`The given repository (${repository.constructor.name}) should expose a unitOfWorkManager in order to hard delete.`);
}

function scheduleHardDelete(currentUow: IUnitOfWork, entities: Iterable<IEntityBase>): void {
  let hardDeleted = currentUow.items.get(UnitOfWorkItemNames.HardDeletedEntities);
  if (!(hardDeleted instanceof Set)) {
    hardDeleted = new Set<IEntityBase>();
    currentUow.items.set(UnitOfWorkItemNames.HardDeletedEntities, hardDeleted);
  }
  for (const entity of entities) (hardDeleted as Set<IEntityBase>).add(entity);
}

async function withUnitOfWork(unitOfWorkManager: IUnitOfWorkManager, action: (uow: IUnitOfWork) => Promise<void>): Promise<void> {
  const current = unitOfWorkManager.current;
  if (current) {
    await action(current);
    return;
  }
  const uow = unitOfWorkManager.begin();
  try {
    await action(unitOfWorkManager.current ?? uow);
    await uow.complete();
  } finally {
    await uow.dispose();
  }
}

/**
 * Port of `HardDeleteAsync`: physically deletes soft-deletable entities (given, or matched by the predicate with the
 * soft-delete filter disabled) by marking them in the unit of work before deleting.
 */
export async function hardDelete<TEntity extends IEntity<TKey> & ISoftDelete, TKey>(repository: IRepository<TEntity, TKey>, target: TEntity | Iterable<TEntity> | EntityPredicate<TEntity>, autoSave = false, signal?: AbortSignal): Promise<void> {
  const unitOfWorkManager = unitOfWorkManagerOf(repository);
  await withUnitOfWork(unitOfWorkManager, async (currentUow) => {
    if (typeof target === "function" || (typeof target === "object" && target !== null && "toExpression" in target && !isIterable(target))) {
      const dataFilter = currentUow.serviceProvider.getRequired(IDataFilter);
      const entities: TEntity[] = await dataFilter.runDisabled(SoftDeleteFilter, async () => (await repository.getQueryable()).where(target as EntityPredicate<TEntity>).toList(signal));
      scheduleHardDelete(currentUow, entities);
      await repository.deleteMany(entities, autoSave, signal);
      return;
    }
    const entities: TEntity[] = isIterable(target) ? [...(target as Iterable<TEntity>)] : [target as TEntity];
    scheduleHardDelete(currentUow, entities);
    await repository.deleteMany(entities, autoSave, signal);
  });
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.iterator in value;
}

/** Port of `DisableTracking` / `EnableTracking`: sets `isChangeTrackingEnabled` until disposed. */
export function disableTracking(repository: IReadOnlyBasicRepository<IEntity<unknown>, unknown>): Disposable {
  return tracking(repository, false);
}

export function enableTracking(repository: IReadOnlyBasicRepository<IEntity<unknown>, unknown>): Disposable {
  return tracking(repository, true);
}

function tracking(repository: IReadOnlyBasicRepository<IEntity<unknown>, unknown>, enabled: boolean): Disposable {
  const target = repository as { isChangeTrackingEnabled: boolean | undefined };
  const previous = target.isChangeTrackingEnabled;
  target.isChangeTrackingEnabled = enabled;
  return new DisposeAction(() => {
    target.isChangeTrackingEnabled = previous;
  });
}

/** Port of `SetEntityName`. */
export function setEntityName<TRepository extends IReadOnlyBasicRepository<IEntity<unknown>, unknown>>(repository: TRepository, name: string): TRepository {
  repository.entityName = name;
  return repository;
}
