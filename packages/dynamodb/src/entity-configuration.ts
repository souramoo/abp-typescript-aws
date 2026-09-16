import { AbpException, Check, type AbstractClass } from "@abp/core";
import { hasCreationTime } from "@abp/auditing";
import { isCreationAuditedEntityType } from "@abp/ddd-domain";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { DynamoDbIndexKey } from "./abp-dynamodb-options.js";

export type DynamoDbKeyValue = string | number | undefined;

/** An extra index (`gsi2`/`gsi3`) of an entity; `gsi1` is reserved for the per-entity list index. */
export interface DynamoDbIndexConfiguration<TEntity extends object = object> {
  readonly index: DynamoDbIndexKey;
  /** When true (default) the partition key is wrapped as `<prefix><tenant|host>#<EntityName>#<value>` so tenants never share index partitions. */
  readonly scoped: boolean;
  pk(entity: TEntity): DynamoDbKeyValue;
  /** Undefined means "use the entity id". */
  sk(entity: TEntity): DynamoDbKeyValue;
}

/** Port of `IMongoEntityModel`: how one entity class maps to items of the single table. */
export interface DynamoDbEntityConfiguration<TEntity extends object = object> {
  readonly entityType: AbstractClass<TEntity>;
  /** The `<EntityName>` segment of the keys (port of the collection name). */
  readonly name: string;
  readonly keyProperty: string;
  /** The tenant id is part of the partition key; defaults to whether instances declare `tenantId`. */
  readonly multiTenant: boolean;
  /** `gsi1sk = <creationTime ISO>#<id>` instead of `<id>`; defaults to whether instances declare `creationTime`. */
  readonly creationTimeInSortKey: boolean;
  readonly indexes: readonly DynamoDbIndexConfiguration<TEntity>[];
  readonly hasTtl: boolean;
  getKey(entity: TEntity): unknown;
  /** A `Date` or epoch seconds written to the table's TTL attribute; undefined for no expiration. */
  ttl(entity: TEntity): Date | number | undefined;
}

export interface DynamoDbIndexOptions<TEntity extends object> {
  pk: (entity: TEntity) => DynamoDbKeyValue;
  sk?: (entity: TEntity) => DynamoDbKeyValue;
  scoped?: boolean;
}

function probeInstance<TEntity extends object>(entityType: AbstractClass<TEntity>): TEntity | undefined {
  try {
    return Reflect.construct(entityType as unknown as new () => TEntity, []) as TEntity;
  } catch {
    return undefined;
  }
}

/** Port of `IMongoEntityModelBuilder`: `builder.entity(Book, b => b.name("Books").index("gsi2", { pk: x => x.isbn }))`. */
export class DynamoDbEntityTypeBuilder<TEntity extends object> {
  private entityName: string;
  private keyProperty = "id";
  private keySelector: (entity: TEntity) => unknown = (entity) => (entity as { id?: unknown }).id;
  private readonly indexes: DynamoDbIndexConfiguration<TEntity>[] = [];
  private ttlSelector: ((entity: TEntity) => Date | number | undefined) | undefined = undefined;
  private isMultiTenant: boolean;
  private orderedByCreationTime: boolean;

  constructor(readonly entityType: AbstractClass<TEntity>) {
    const probe = probeInstance(entityType);
    this.entityName = entityType.name;
    this.isMultiTenant = probe !== undefined && isMultiTenant(probe);
    this.orderedByCreationTime = probe !== undefined ? hasCreationTime(probe) : isCreationAuditedEntityType(entityType);
  }

  /** The key segment used for this entity (port of `[MongoCollection("...")]`). Default: the class name. */
  name(name: string): this {
    this.entityName = Check.notNullOrWhiteSpace(name, "name");
    return this;
  }

  /** The primary key selector (default `entity.id`); `propertyName` is used for native sorting decisions. */
  key(selector: (entity: TEntity) => unknown, propertyName = "id"): this {
    this.keySelector = selector;
    this.keyProperty = propertyName;
    return this;
  }

  index(index: DynamoDbIndexKey, options: DynamoDbIndexOptions<TEntity>): this {
    if (index === "gsi1") throw new AbpException(`gsi1 is the list index of every entity and cannot be configured for ${this.entityType.name}. Use gsi2 or gsi3.`);
    if (this.indexes.some((i) => i.index === index)) throw new AbpException(`Index ${index} is already configured for ${this.entityType.name}.`);
    const { pk, sk, scoped = true } = options;
    this.indexes.push({ index, scoped, pk: (entity) => pk(entity), sk: (entity) => sk?.(entity) });
    return this;
  }

  ttl(selector: (entity: TEntity) => Date | number | undefined): this {
    this.ttlSelector = selector;
    return this;
  }

  multiTenant(value = true): this {
    this.isMultiTenant = value;
    return this;
  }

  orderByCreationTime(value = true): this {
    this.orderedByCreationTime = value;
    return this;
  }

  build(): DynamoDbEntityConfiguration<TEntity> {
    const keySelector = this.keySelector;
    const ttlSelector = this.ttlSelector;
    return {
      entityType: this.entityType,
      name: this.entityName,
      keyProperty: this.keyProperty,
      multiTenant: this.isMultiTenant,
      creationTimeInSortKey: this.orderedByCreationTime,
      indexes: [...this.indexes],
      hasTtl: ttlSelector !== undefined,
      getKey: (entity) => keySelector(entity),
      ttl: (entity) => ttlSelector?.(entity),
    };
  }
}

/** Port of `MongoDbContextModel`. */
export class DynamoDbContextModel {
  constructor(readonly entities: ReadonlyMap<AbstractClass, DynamoDbEntityConfiguration>) {}

  get entityTypes(): readonly AbstractClass[] {
    return [...this.entities.keys()];
  }

  /** The configuration of the class or of its nearest configured base class. */
  findConfiguration<TEntity extends object>(entityType: AbstractClass<TEntity>): DynamoDbEntityConfiguration<TEntity> | undefined {
    const exact = this.entities.get(entityType);
    if (exact) return exact as DynamoDbEntityConfiguration<TEntity>;
    for (const [type, configuration] of this.entities) {
      if (entityType.prototype instanceof type) return configuration as DynamoDbEntityConfiguration<TEntity>;
    }
    return undefined;
  }

  getConfiguration<TEntity extends object>(entityType: AbstractClass<TEntity>): DynamoDbEntityConfiguration<TEntity> {
    const configuration = this.findConfiguration(entityType);
    if (!configuration) throw new AbpException(`Could not find a model for given entity type: ${entityType.name}. Register it in configureEntities(builder) with builder.entity(${entityType.name}).`);
    return configuration;
  }
}

/** Port of `IMongoModelBuilder`. */
export class DynamoDbModelBuilder {
  private readonly builders = new Map<AbstractClass, DynamoDbEntityTypeBuilder<object>>();

  entity<TEntity extends object>(entityType: AbstractClass<TEntity>, configure?: (builder: DynamoDbEntityTypeBuilder<TEntity>) => void): this {
    Check.notNull(entityType, "entityType");
    let builder = this.builders.get(entityType) as DynamoDbEntityTypeBuilder<TEntity> | undefined;
    if (!builder) {
      builder = new DynamoDbEntityTypeBuilder(entityType);
      this.builders.set(entityType, builder as unknown as DynamoDbEntityTypeBuilder<object>);
    }
    configure?.(builder);
    return this;
  }

  build(): DynamoDbContextModel {
    const entities = new Map<AbstractClass, DynamoDbEntityConfiguration>();
    for (const [type, builder] of this.builders) entities.set(type, builder.build());
    return new DynamoDbContextModel(entities);
  }
}
