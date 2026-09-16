import { Check, DisableInterception, ICancellationTokenProvider, ILoggerFactory, NullCancellationTokenProvider, NullLogger, type AbstractClass, type Class, type IAbpLazyServiceProvider, type ILogger, type ISoftDelete } from "@abp/core";
import { IAuditPropertySetter } from "@abp/auditing";
import { IDataFilter, MultiTenantFilter, SoftDeleteFilter } from "@abp/data";
import { IGuidGenerator, SimpleGuidGenerator } from "@abp/guids";
import { ICurrentTenant, isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager, UnitOfWorkEnabled, UnitOfWorkEventRecord, type IUnitOfWork } from "@abp/uow";
import { generatesDomainEvents, isDefaultKeyValue, keysEqual, type IEntity, type IEntityBase } from "../entities/entity.js";
import { EntityHelper } from "../entities/entity-helper.js";
import { EntityNotFoundException } from "../entities/entity-not-found-exception.js";
import { IEntityChangeEventHelper, NullEntityChangeEventHelper } from "../entities/events/entity-change-event-helper.js";
import { IEntityChangeTrackingProvider } from "../change-tracking/change-tracking.js";
import { toPredicate, type EntityPredicate, type IQueryable } from "./queryable.js";
import { UnitOfWorkItemNames, type IBasicRepository, type IRepository } from "./repository.js";

function isSoftDelete(value: unknown): value is ISoftDelete {
  return typeof value === "object" && value !== null && "isDeleted" in value;
}

/**
 * Port of `BasicRepositoryBase<TEntity, TKey>`. Repositories are unit-of-work enabled (the marker is inherited) so
 * every public method call from outside runs inside a unit of work; public members must therefore be async.
 * `entityType` is passed explicitly because generic arguments are erased.
 */
export abstract class BasicRepositoryBase<TEntity extends IEntity<TKey>, TKey> implements IBasicRepository<TEntity, TKey> {
  lazyServiceProvider!: IAbpLazyServiceProvider;
  readonly providerName: string;
  readonly entityType: AbstractClass<TEntity>;
  entityName: string | undefined = undefined;
  isChangeTrackingEnabled: boolean | undefined = undefined;

  protected constructor(providerName: string, entityType: AbstractClass<TEntity>) {
    this.providerName = Check.notNullOrWhiteSpace(providerName, "providerName");
    this.entityType = Check.notNull(entityType, "entityType");
  }

  get dataFilter(): IDataFilter {
    return this.lazyServiceProvider.lazyGetRequiredService(IDataFilter);
  }
  get currentTenant(): ICurrentTenant {
    return this.lazyServiceProvider.lazyGetRequiredService(ICurrentTenant);
  }
  get unitOfWorkManager(): IUnitOfWorkManager {
    return this.lazyServiceProvider.lazyGetRequiredService(IUnitOfWorkManager);
  }
  get cancellationTokenProvider(): ICancellationTokenProvider {
    return this.lazyServiceProvider.lazyGetServiceOr(ICancellationTokenProvider, NullCancellationTokenProvider.instance);
  }
  get loggerFactory(): ILoggerFactory | undefined {
    return this.lazyServiceProvider.lazyGetService(ILoggerFactory);
  }
  get logger(): ILogger {
    return this.lazyServiceProvider.lazyGetServiceFrom(ILoggerFactory, () => this.loggerFactory?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }
  get entityChangeTrackingProvider(): IEntityChangeTrackingProvider {
    return this.lazyServiceProvider.lazyGetRequiredService(IEntityChangeTrackingProvider);
  }
  get auditPropertySetter(): IAuditPropertySetter {
    return this.lazyServiceProvider.lazyGetRequiredService(IAuditPropertySetter);
  }
  get guidGenerator(): IGuidGenerator {
    return this.lazyServiceProvider.lazyGetServiceOr(IGuidGenerator, SimpleGuidGenerator.instance);
  }
  get entityChangeEventHelper(): IEntityChangeEventHelper {
    return this.lazyServiceProvider.lazyGetServiceOr(IEntityChangeEventHelper, NullEntityChangeEventHelper.instance);
  }

  abstract insert(entity: TEntity, autoSave?: boolean, signal?: AbortSignal): Promise<TEntity>;
  abstract update(entity: TEntity, autoSave?: boolean, signal?: AbortSignal): Promise<TEntity>;
  abstract delete(entity: TEntity, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  abstract getList(includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  abstract getCount(signal?: AbortSignal): Promise<number>;
  abstract getPagedList(skipCount: number, maxResultCount: number, sorting: string | null | undefined, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity[]>;
  abstract find(id: TKey, includeDetails?: boolean, signal?: AbortSignal): Promise<TEntity | undefined>;

  async insertMany(entities: Iterable<TEntity>, autoSave = false, signal?: AbortSignal): Promise<void> {
    for (const entity of entities) await this.insert(entity, false, signal);
    if (autoSave) await this.saveChanges(signal);
  }

  async updateMany(entities: Iterable<TEntity>, autoSave = false, signal?: AbortSignal): Promise<void> {
    for (const entity of entities) await this.update(entity, false, signal);
    if (autoSave) await this.saveChanges(signal);
  }

  async deleteMany(entities: Iterable<TEntity>, autoSave = false, signal?: AbortSignal): Promise<void> {
    for (const entity of entities) await this.delete(entity, false, signal);
    if (autoSave) await this.saveChanges(signal);
  }

  async get(id: TKey, includeDetails = true, signal?: AbortSignal): Promise<TEntity> {
    const entity = await this.find(id, includeDetails, signal);
    if (entity === undefined) throw new EntityNotFoundException(this.entityType, id);
    return entity;
  }

  async deleteById(id: TKey, autoSave = false, signal?: AbortSignal): Promise<void> {
    const entity = await this.find(id, true, signal);
    if (entity === undefined) return;
    await this.delete(entity, autoSave, signal);
  }

  async deleteManyByIds(ids: Iterable<TKey>, autoSave = false, signal?: AbortSignal): Promise<void> {
    for (const id of ids) await this.deleteById(id, false, signal);
    if (autoSave) await this.saveChanges(signal);
  }

  protected async saveChanges(_signal?: AbortSignal): Promise<void> {
    const current = this.unitOfWorkManager.current;
    if (current) await current.saveChanges();
  }

  protected getCancellationToken(preferredValue?: AbortSignal): AbortSignal | undefined {
    return this.cancellationTokenProvider.fallbackToProvider(preferredValue);
  }

  /** Port of `ShouldTrackingEntityChange`: the repository flag wins, then the ambient provider, then `true`. */
  @DisableInterception()
  shouldTrackingEntityChange(): boolean {
    if (this.isChangeTrackingEnabled !== undefined) return this.isChangeTrackingEnabled;
    const ambient = this.entityChangeTrackingProvider.enabled;
    if (ambient !== undefined) return ambient;
    return true;
  }

  /* Shared "ABP concepts" applied by every provider (ported from MemoryDb/MongoDb repositories). */

  protected trySetTenantId(entity: TEntity): void {
    EntityHelper.trySetTenantId(entity);
  }

  /** Assigns a new guid to an unset string id (`DisableIdGeneration` classes are skipped); numeric ids are left to the provider. */
  protected trySetGuidId(entity: TEntity): void {
    const id: unknown = entity.id;
    if (typeof id === "number" || typeof id === "bigint") return;
    if (!isDefaultKeyValue(id)) return;
    EntityHelper.trySetId(entity as IEntity<unknown>, () => this.guidGenerator.create(), true);
  }

  protected setCreationAuditProperties(entity: TEntity): void {
    this.auditPropertySetter.setCreationProperties(entity);
  }

  protected setModificationAuditProperties(entity: TEntity): void {
    this.auditPropertySetter.setModificationProperties(entity);
  }

  protected setDeletionAuditProperties(entity: TEntity): void {
    this.auditPropertySetter.setDeletionProperties(entity);
  }

  protected incrementEntityVersionProperty(entity: TEntity): void {
    this.auditPropertySetter.incrementEntityVersionProperty(entity);
  }

  protected triggerEntityCreateEvents(entity: TEntity): void {
    this.entityChangeEventHelper.publishEntityCreatedEvent(entity);
  }

  protected triggerEntityUpdateEvents(entity: TEntity): void {
    this.entityChangeEventHelper.publishEntityUpdatedEvent(entity);
  }

  protected triggerEntityDeleteEvents(entity: TEntity): void {
    this.entityChangeEventHelper.publishEntityDeletedEvent(entity);
  }

  /** Moves the aggregate's domain events into the current unit of work. */
  protected triggerDomainEvents(entity: object): void {
    if (!generatesDomainEvents(entity)) return;
    const currentUow = this.unitOfWorkManager.current;

    const localEvents = [...entity.getLocalEvents()];
    if (localEvents.length > 0) {
      for (const localEvent of localEvents) {
        currentUow?.addOrReplaceLocalEvent(new UnitOfWorkEventRecord(localEvent.eventData.constructor as Class, localEvent.eventData, localEvent.eventOrder));
      }
      entity.clearLocalEvents();
    }

    const distributedEvents = [...entity.getDistributedEvents()];
    if (distributedEvents.length > 0) {
      for (const distributedEvent of distributedEvents) {
        currentUow?.addOrReplaceDistributedEvent(new UnitOfWorkEventRecord(distributedEvent.eventData.constructor as Class, distributedEvent.eventData, distributedEvent.eventOrder, true));
      }
      entity.clearDistributedEvents();
    }
  }

  /** Port of `ApplyAbpConceptsForAddedEntity`. */
  protected applyAbpConceptsForAddedEntity(entity: TEntity): void {
    this.trySetTenantId(entity);
    this.trySetGuidId(entity);
    this.setCreationAuditProperties(entity);
    this.triggerEntityCreateEvents(entity);
    this.triggerDomainEvents(entity);
  }

  /** Port of the update part of `ApplyAbpConcepts`: audit + version + update or (soft) delete events. */
  protected applyAbpConceptsForUpdatedEntity(entity: TEntity): void {
    this.incrementEntityVersionProperty(entity);
    this.setModificationAuditProperties(entity);
    if (isSoftDelete(entity) && entity.isDeleted) {
      this.setDeletionAuditProperties(entity);
      this.triggerEntityDeleteEvents(entity);
    } else {
      this.triggerEntityUpdateEvents(entity);
    }
    this.triggerDomainEvents(entity);
  }

  /** Port of `ApplyAbpConceptsForDeletedEntity`. */
  protected applyAbpConceptsForDeletedEntity(entity: TEntity): void {
    this.setDeletionAuditProperties(entity);
    this.triggerEntityDeleteEvents(entity);
    this.triggerDomainEvents(entity);
  }

  /** Port of `IsHardDeleted`: the entity was scheduled for a hard delete through `hardDelete(...)`. */
  protected isHardDeleted(entity: TEntity): boolean {
    const hardDeleted = this.unitOfWorkManager.current?.items.get(UnitOfWorkItemNames.HardDeletedEntities);
    return hardDeleted instanceof Set && hardDeleted.has(entity);
  }

  /** Soft-deletable entities are marked instead of removed unless hard-deleted; returns true when the row must go. */
  protected shouldHardDelete(entity: TEntity): boolean {
    return !isSoftDelete(entity) || this.isHardDeleted(entity);
  }

  protected currentUnitOfWork(): IUnitOfWork | undefined {
    return this.unitOfWorkManager.current;
  }
}
UnitOfWorkEnabled.mark(BasicRepositoryBase as unknown as AbstractClass);
DisableInterception()(BasicRepositoryBase.prototype, "entityType");

/**
 * Port of `RepositoryBase<TEntity, TKey>`. Providers implement `getQueryable` (already data-filtered through
 * `applyDataFilters`) and the write operations; the predicate-based reads derive from the query.
 */
export abstract class RepositoryBase<TEntity extends IEntity<TKey>, TKey> extends BasicRepositoryBase<TEntity, TKey> implements IRepository<TEntity, TKey> {
  abstract getQueryable(): Promise<IQueryable<TEntity>>;
  abstract deleteDirect(predicate: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<void>;

  query(): Promise<IQueryable<TEntity>> {
    return this.getQueryable();
  }

  withDetails(): Promise<IQueryable<TEntity>> {
    return this.getQueryable();
  }

  override async find(idOrPredicate: TKey | EntityPredicate<TEntity>, includeDetails = true, signal?: AbortSignal): Promise<TEntity | undefined> {
    if (isPredicate(idOrPredicate)) return (await this.getQueryable()).where(idOrPredicate).singleOrDefault(signal);
    return this.findById(idOrPredicate as TKey, includeDetails, signal);
  }

  /** Port of `FindAsync(TKey id)`; the default scans the query, providers override with a key lookup. */
  protected async findById(id: TKey, _includeDetails = true, signal?: AbortSignal): Promise<TEntity | undefined> {
    return (await this.getQueryable()).where((e) => keysEqual(e.id, id)).firstOrDefault(signal);
  }

  override async get(idOrPredicate: TKey | EntityPredicate<TEntity>, includeDetails = true, signal?: AbortSignal): Promise<TEntity> {
    if (isPredicate(idOrPredicate)) {
      const entity = await this.find(idOrPredicate, includeDetails, signal);
      if (entity === undefined) throw new EntityNotFoundException(this.entityType);
      return entity;
    }
    return super.get(idOrPredicate as TKey, includeDetails, signal);
  }

  override async getList(predicateOrIncludeDetails?: EntityPredicate<TEntity> | boolean, includeDetailsOrSignal?: boolean | AbortSignal, signal?: AbortSignal): Promise<TEntity[]> {
    if (predicateOrIncludeDetails !== undefined && typeof predicateOrIncludeDetails !== "boolean") {
      return (await this.getQueryable()).where(predicateOrIncludeDetails).toList(signal);
    }
    return (await this.getQueryable()).toList(includeDetailsOrSignal instanceof AbortSignal ? includeDetailsOrSignal : signal);
  }

  async getCount(signal?: AbortSignal): Promise<number> {
    return (await this.getQueryable()).count(signal);
  }

  async getPagedList(skipCount: number, maxResultCount: number, sorting: string | null | undefined, _includeDetails = false, signal?: AbortSignal): Promise<TEntity[]> {
    return (await this.getQueryable()).orderBySorting(sorting).skip(skipCount).take(maxResultCount).toList(signal);
  }

  async count(predicate?: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<number> {
    const query = await this.getQueryable();
    return (predicate ? query.where(predicate) : query).count(signal);
  }

  async any(predicate?: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<boolean> {
    const query = await this.getQueryable();
    return (predicate ? query.where(predicate) : query).any(signal);
  }

  async firstOrDefault(predicate?: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<TEntity | undefined> {
    const query = (await this.getQueryable()).orderBy("id");
    return (predicate ? query.where(predicate) : query).firstOrDefault(signal);
  }

  override async deleteMany(entitiesOrPredicate: Iterable<TEntity> | EntityPredicate<TEntity>, autoSave = false, signal?: AbortSignal): Promise<void> {
    if (isPredicate(entitiesOrPredicate)) {
      const entities = await (await this.getQueryable()).where(entitiesOrPredicate).toList(signal);
      await super.deleteMany(entities, autoSave, signal);
      return;
    }
    await super.deleteMany(entitiesOrPredicate as Iterable<TEntity>, autoSave, signal);
  }

  /** Port of `ApplyDataFilters`: soft-delete and multi-tenant filters evaluated per entity (types are erased). */
  protected applyDataFilters(query: IQueryable<TEntity>): IQueryable<TEntity> {
    let result = query;
    if (this.dataFilter.isEnabled(SoftDeleteFilter)) result = result.where((e) => !isSoftDelete(e) || !e.isDeleted);
    if (this.dataFilter.isEnabled(MultiTenantFilter)) {
      const tenantId = this.currentTenant.id;
      result = result.where((e) => !isMultiTenant(e) || (e.tenantId ?? undefined) === tenantId);
    }
    return result;
  }

  /** The same filters as a predicate, for providers that filter before building a query. */
  protected dataFilterPredicate(): (entity: IEntityBase) => boolean {
    const softDelete = this.dataFilter.isEnabled(SoftDeleteFilter);
    const multiTenant = this.dataFilter.isEnabled(MultiTenantFilter);
    const tenantId = this.currentTenant.id;
    return (e) => (!softDelete || !isSoftDelete(e) || !e.isDeleted) && (!multiTenant || !isMultiTenant(e) || (e.tenantId ?? undefined) === tenantId);
  }
}

function isPredicate<T>(value: unknown): value is EntityPredicate<T> {
  return typeof value === "function" || (typeof value === "object" && value !== null && typeof (value as { toExpression?: unknown }).toExpression === "function");
}

export { toPredicate, isPredicate, isSoftDelete };
