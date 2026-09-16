import { optionsToken, type AbstractClass, type Class } from "@abp/core";
import { EntityChangeType, IAuditingManager, IEntityHistoryHelper, type EntitySnapshot } from "@abp/auditing";
import { MultiTenantFilter, SoftDeleteFilter, type IHasConcurrencyStamp } from "@abp/data";
import { RepositoryBase, isSoftDelete, newConcurrencyStamp, type EntityKeyOf, type EntityPredicate, type IEntity, type IQueryable } from "@abp/ddd-domain";
import { AbpDynamoDbConsts } from "./abp-dynamodb-consts.js";
import { AbpDynamoDbOptions } from "./abp-dynamodb-options.js";
import type { AbpDynamoDbContext } from "./abp-dynamodb-context.js";
import { dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "./dynamodb-context-provider.js";
import { MustExistCondition, MustNotExistCondition, NoCondition, type DynamoDbDatabase, type DynamoDbWriteCondition } from "./dynamodb-database.js";
import { DefaultDynamoDbEntitySerializer, IDynamoDbEntitySerializer, type DynamoDbItem } from "./dynamodb-entity-serializer.js";
import { reservedAttributeNames, type DynamoDbItemKey } from "./dynamodb-keys.js";
import { DynamoDbQueryable } from "./dynamodb-queryable.js";
import type { DynamoDbEntityConfiguration } from "./entity-configuration.js";

/** Port of `IMongoDbRepository<TEntity, TKey>`. */
export interface IDynamoDbRepository<TDbContext extends AbpDynamoDbContext, TEntity extends IEntity<TKey>, TKey> {
  getDbContext(signal?: AbortSignal): Promise<TDbContext>;
  getDatabase(signal?: AbortSignal): Promise<DynamoDbDatabase>;
  getEntityConfiguration(signal?: AbortSignal): Promise<DynamoDbEntityConfiguration<TEntity>>;
  /** The data-filtered query with the DynamoDB-specific `usingIndex`/`toPage` members. */
  getDynamoDbQueryable(signal?: AbortSignal): Promise<DynamoDbQueryable<TEntity>>;
}

function hasConcurrencyStamp(value: unknown): value is IHasConcurrencyStamp {
  return typeof value === "object" && value !== null && "concurrencyStamp" in value;
}

function snapshotOf(entity: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entity).filter(([, value]) => typeof value !== "function"));
}

/**
 * Port of `MongoDbRepository<TMongoDbContext, TEntity, TKey>` on the single table. Writes are buffered in the unit of
 * work's table session and flushed on `saveChanges` (conditional on the concurrency stamp, like the MongoDB
 * `ReplaceOne` filters); reads by id are `GetItem`s, lists are `Query`s on `gsi1`.
 *
 * Multi-tenancy: the tenant is part of the key, so the `IMultiTenant` data filter decides the key space a read uses
 * (the current tenant, or the host when the filter is disabled); writes always go to the entity's own tenant. Entity
 * history (when enabled for the class) reads the stored item before an update to build the property changes.
 */
export class DynamoDbRepository<TDbContext extends AbpDynamoDbContext, TEntity extends IEntity<TKey>, TKey> extends RepositoryBase<TEntity, TKey> implements IDynamoDbRepository<TDbContext, TEntity, TKey> {
  constructor(
    protected readonly dbContextProvider: IDynamoDbContextProvider<TDbContext>,
    entityType: AbstractClass<TEntity>,
  ) {
    super(AbpDynamoDbConsts.ProviderName, entityType);
  }

  get entitySerializer(): IDynamoDbEntitySerializer {
    return this.lazyServiceProvider.lazyGetServiceFrom(IDynamoDbEntitySerializer, (provider) => provider.get(IDynamoDbEntitySerializer) ?? new DefaultDynamoDbEntitySerializer());
  }

  get entityHistoryHelper(): IEntityHistoryHelper | undefined {
    return this.lazyServiceProvider.lazyGetService(IEntityHistoryHelper);
  }

  get auditingManager(): IAuditingManager | undefined {
    return this.lazyServiceProvider.lazyGetService(IAuditingManager);
  }

  get dynamoDbOptions(): AbpDynamoDbOptions {
    return this.lazyServiceProvider.lazyGetRequiredService(optionsToken(AbpDynamoDbOptions)).value;
  }

  getDbContext(signal?: AbortSignal): Promise<TDbContext> {
    return this.dbContextProvider.getDbContext(this.getCancellationToken(signal));
  }

  async getDatabase(signal?: AbortSignal): Promise<DynamoDbDatabase> {
    return (await this.getDbContext(signal)).database;
  }

  async getEntityConfiguration(signal?: AbortSignal): Promise<DynamoDbEntityConfiguration<TEntity>> {
    return (await this.getDbContext(signal)).getEntityConfiguration(this.entityType);
  }

  async getQueryable(): Promise<IQueryable<TEntity>> {
    return this.getDynamoDbQueryable();
  }

  async getDynamoDbQueryable(signal?: AbortSignal): Promise<DynamoDbQueryable<TEntity>> {
    const dbContext = await this.getDbContext(signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    return new DynamoDbQueryable<TEntity>({
      database: dbContext.database,
      configuration,
      scope: this.readScope(dbContext, configuration),
      softDeleteFilter: this.dataFilter.isEnabled(SoftDeleteFilter),
      toEntity: (item) => this.toEntity(item, configuration),
    });
  }

  async insert(entity: TEntity, autoSave = false, signal?: AbortSignal): Promise<TEntity> {
    this.applyAbpConceptsForAddedEntity(entity);
    this.setConcurrencyStampIfNull(entity);

    const dbContext = await this.getDbContext(signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    dbContext.database.put(dbContext.database.keyBuilder.entityKey(configuration, entity), this.toItem(dbContext, configuration, entity), MustNotExistCondition);
    this.saveEntityHistory(entity, EntityChangeType.Created, { current: snapshotOf(entity) });

    if (autoSave) await this.saveChanges(signal);
    return entity;
  }

  async update(entity: TEntity, autoSave = false, signal?: AbortSignal): Promise<TEntity> {
    const dbContext = await this.getDbContext(signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    const original = await this.loadOriginalSnapshot(dbContext, configuration, entity, signal);

    this.applyAbpConceptsForUpdatedEntity(entity);
    const oldConcurrencyStamp = this.setNewConcurrencyStamp(entity);
    dbContext.database.put(dbContext.database.keyBuilder.entityKey(configuration, entity), this.toItem(dbContext, configuration, entity), this.concurrencyCondition(oldConcurrencyStamp));
    this.saveEntityHistory(entity, isSoftDelete(entity) && entity.isDeleted ? EntityChangeType.Deleted : EntityChangeType.Updated, { original, current: snapshotOf(entity) });

    if (autoSave) await this.saveChanges(signal);
    return entity;
  }

  async delete(entity: TEntity, autoSave = false, signal?: AbortSignal): Promise<void> {
    const dbContext = await this.getDbContext(signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    const key = dbContext.database.keyBuilder.entityKey(configuration, entity);
    const original = snapshotOf(entity);
    const oldConcurrencyStamp = this.setNewConcurrencyStamp(entity);

    if (!this.shouldHardDelete(entity) && isSoftDelete(entity)) {
      entity.isDeleted = true;
      this.applyAbpConceptsForDeletedEntity(entity);
      dbContext.database.put(key, this.toItem(dbContext, configuration, entity), this.concurrencyCondition(oldConcurrencyStamp));
    } else {
      this.applyAbpConceptsForDeletedEntity(entity);
      dbContext.database.delete(key, this.concurrencyCondition(oldConcurrencyStamp));
    }
    this.saveEntityHistory(entity, EntityChangeType.Deleted, { original });

    if (autoSave) await this.saveChanges(signal);
  }

  /** Port of `DeleteDirectAsync`: hard deletes the matching items without audit properties or entity events. */
  async deleteDirect(predicate: EntityPredicate<TEntity>, signal?: AbortSignal): Promise<void> {
    const dbContext = await this.getDbContext(signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    const entities = await (await this.getDynamoDbQueryable(signal)).where(predicate).toList(signal);
    for (const entity of entities) dbContext.database.delete(dbContext.database.keyBuilder.entityKey(configuration, entity), NoCondition);
    await this.saveChanges(signal);
  }

  protected override async findById(id: TKey, _includeDetails = true, signal?: AbortSignal): Promise<TEntity | undefined> {
    const dbContext = await this.getDbContext(signal);
    const configuration = dbContext.getEntityConfiguration(this.entityType);
    const key = dbContext.database.keyBuilder.itemKey(configuration, this.readScope(dbContext, configuration), id);

    const pending = dbContext.database.findPending(key);
    if (pending) return pending.kind === "delete" ? undefined : this.filterRead(this.toEntity(pending.item, configuration));

    const item = await dbContext.database.getItem(key, this.dynamoDbOptions.consistentRead, this.getCancellationToken(signal));
    return item === undefined ? undefined : this.filterRead(this.toEntity(item, configuration));
  }

  /** The key space reads use: the current tenant while the `IMultiTenant` filter is enabled, the host otherwise. */
  protected readScope(dbContext: TDbContext, configuration: DynamoDbEntityConfiguration<TEntity>): string {
    if (!configuration.multiTenant || !this.dataFilter.isEnabled(MultiTenantFilter)) return AbpDynamoDbConsts.HostScope;
    return dbContext.database.keyBuilder.scopeOf(this.currentTenant.id);
  }

  protected filterRead(entity: TEntity): TEntity | undefined {
    if (this.dataFilter.isEnabled(SoftDeleteFilter) && isSoftDelete(entity) && entity.isDeleted) return undefined;
    return entity;
  }

  protected toItem(dbContext: TDbContext, configuration: DynamoDbEntityConfiguration<TEntity>, entity: TEntity): DynamoDbItem {
    const { keyBuilder, options } = dbContext.database;
    const scope = keyBuilder.writeScope(configuration, entity);
    const item: DynamoDbItem = { ...this.entitySerializer.serialize(entity), ...keyBuilder.itemKey(configuration, scope, configuration.getKey(entity)), ...keyBuilder.indexAttributes(configuration, scope, entity), [AbpDynamoDbConsts.EntityTypeAttribute]: configuration.name };
    const ttl = configuration.hasTtl ? configuration.ttl(entity) : undefined;
    if (ttl !== undefined) item[options.ttlAttribute] = ttl instanceof Date ? Math.ceil(ttl.getTime() / 1000) : ttl;
    return item;
  }

  protected toEntity(item: DynamoDbItem, configuration: DynamoDbEntityConfiguration<TEntity>): TEntity {
    const reserved = reservedAttributeNames(this.dynamoDbOptions);
    const attributes: DynamoDbItem = {};
    for (const [key, value] of Object.entries(item)) if (!reserved.has(key)) attributes[key] = value;
    return this.entitySerializer.deserialize(attributes, configuration.entityType);
  }

  protected setConcurrencyStampIfNull(entity: TEntity): void {
    if (hasConcurrencyStamp(entity) && !entity.concurrencyStamp) entity.concurrencyStamp = newConcurrencyStamp();
  }

  /** Port of `SetNewConcurrencyStamp`: assigns a new stamp and returns the old one used in the write condition. */
  protected setNewConcurrencyStamp(entity: TEntity): string | undefined {
    if (!hasConcurrencyStamp(entity)) return undefined;
    const oldConcurrencyStamp = entity.concurrencyStamp;
    entity.concurrencyStamp = newConcurrencyStamp();
    return oldConcurrencyStamp || undefined;
  }

  protected concurrencyCondition(oldConcurrencyStamp: string | undefined): DynamoDbWriteCondition {
    return oldConcurrencyStamp === undefined ? MustExistCondition : { kind: "concurrencyStamp", expected: oldConcurrencyStamp };
  }

  protected isEntityHistoryEnabled(): boolean {
    const helper = this.entityHistoryHelper;
    return helper !== undefined && this.auditingManager?.current !== undefined && helper.isEntityHistoryEnabled(this.entityType as unknown as Class);
  }

  protected async loadOriginalSnapshot(dbContext: TDbContext, configuration: DynamoDbEntityConfiguration<TEntity>, entity: TEntity, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
    if (!this.isEntityHistoryEnabled()) return undefined;
    const key: DynamoDbItemKey = dbContext.database.keyBuilder.entityKey(configuration, entity);
    const pending = dbContext.database.findPending(key);
    const item = pending?.kind === "put" ? pending.item : pending === undefined ? await dbContext.database.getItem(key, true, this.getCancellationToken(signal)) : undefined;
    return item === undefined ? undefined : snapshotOf(this.toEntity(item, configuration));
  }

  protected saveEntityHistory(entity: TEntity, changeType: EntityChangeType, snapshot: EntitySnapshot): void {
    if (!this.isEntityHistoryEnabled()) return;
    const helper = this.entityHistoryHelper!;
    const change = helper.createEntityChangeInfo(entity, changeType, snapshot);
    if (change) helper.addToCurrentAuditLog([change]);
  }
}

export type DynamoDbRepositoryClass<TDbContext extends AbpDynamoDbContext, TEntity extends IEntity<TKey>, TKey> = Class<DynamoDbRepository<TDbContext, TEntity, TKey>>;

const repositoryClasses = new WeakMap<object, Map<AbstractClass, Class>>();

/**
 * Port of `typeof(MongoDbRepository<,,>).MakeGenericType(dbContext, entity, key)`: the closed repository class for a
 * context/entity pair, with `static inject` wired to the context's provider. Cached per pair.
 */
export function dynamoDbRepositoryClassFor<TDbContext extends AbpDynamoDbContext, TEntity extends IEntity<TKey>, TKey = EntityKeyOf<TEntity>>(dbContextType: Class<TDbContext>, entityType: AbstractClass<TEntity>): DynamoDbRepositoryClass<TDbContext, TEntity, TKey> {
  let byEntity = repositoryClasses.get(dbContextType);
  if (!byEntity) {
    byEntity = new Map();
    repositoryClasses.set(dbContextType, byEntity);
  }
  const existing = byEntity.get(entityType);
  if (existing) return existing as DynamoDbRepositoryClass<TDbContext, TEntity, TKey>;

  const providerToken = dynamoDbContextProviderToken(dbContextType);
  const closed = class extends DynamoDbRepository<TDbContext, TEntity, TKey> {
    static readonly inject = [providerToken] as const;
    constructor(dbContextProvider: IDynamoDbContextProvider<TDbContext>) {
      super(dbContextProvider, entityType);
    }
  };
  Object.defineProperty(closed, "name", { value: `DynamoDbRepository<${dbContextType.name}, ${entityType.name}>` });
  byEntity.set(entityType, closed);
  return closed;
}
