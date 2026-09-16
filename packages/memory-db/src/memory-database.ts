import { AbpException, IRootServiceProvider, Singleton, Transient, createToken, type AbstractClass, type Guid, type IServiceProvider } from "@abp/core";
import { AbpDbConcurrencyException } from "@abp/data";
import { IGuidGenerator, SimpleGuidGenerator } from "@abp/guids";
import type { IEntityBase } from "@abp/ddd-domain";

/** Port of `IMemoryDbSerializer`: how entities are stored ("persisted") in a collection. */
export interface IMemoryDbSerializer {
  serialize(obj: object): unknown;
  deserialize<T extends object>(value: unknown, type: AbstractClass<T>): T;
}
export const IMemoryDbSerializer = createToken<IMemoryDbSerializer>("IMemoryDbSerializer");

/**
 * Replacement for `Utf8JsonMemoryDbSerializer`: without runtime type information JSON round-trips would lose
 * `Date`s, `Map`s and class prototypes, so the store keeps deep clones that preserve prototypes instead. Reads
 * still return fresh copies, so callers cannot mutate stored state without `update`.
 */
@Transient(IMemoryDbSerializer)
export class PrototypeCloneMemoryDbSerializer implements IMemoryDbSerializer {
  serialize(obj: object): unknown {
    return deepClone(obj);
  }

  deserialize<T extends object>(value: unknown, _type: AbstractClass<T>): T {
    return deepClone(value) as T;
  }
}

export function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached as T;

  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(deepClone(item, seen));
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new (Object.getPrototypeOf(value).constructor as new () => Map<unknown, unknown>)();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(deepClone(k, seen), deepClone(v, seen));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new (Object.getPrototypeOf(value).constructor as new () => Set<unknown>)();
    seen.set(value, copy);
    for (const v of value) copy.add(deepClone(v, seen));
    return copy as T;
  }
  const copy = Object.create(Object.getPrototypeOf(value) as object | null) as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = deepClone((value as Record<string, unknown>)[key], seen);
  return copy as T;
}

/** Port of `IMemoryDatabaseCollection<TEntity>`. */
export interface IMemoryDatabaseCollection<TEntity extends IEntityBase> extends Iterable<TEntity> {
  readonly size: number;
  add(entity: TEntity): void;
  update(entity: TEntity): void;
  remove(entity: TEntity): void;
}

function hasConcurrencyStamp(value: unknown): value is { concurrencyStamp: string } {
  return typeof value === "object" && value !== null && typeof (value as { concurrencyStamp?: unknown }).concurrencyStamp === "string";
}

/** Port of `MemoryDatabaseCollection<TEntity>`: entities keyed by their joined keys, stored serialized. */
export class MemoryDatabaseCollection<TEntity extends IEntityBase> implements IMemoryDatabaseCollection<TEntity> {
  private readonly dictionary = new Map<string, unknown>();

  constructor(
    readonly entityType: AbstractClass<TEntity>,
    private readonly memoryDbSerializer: IMemoryDbSerializer,
  ) {}

  get size(): number {
    return this.dictionary.size;
  }

  *[Symbol.iterator](): Iterator<TEntity> {
    for (const entity of this.dictionary.values()) yield this.memoryDbSerializer.deserialize(entity, this.entityType);
  }

  add(entity: TEntity): void {
    const key = this.getEntityKey(entity);
    if (this.dictionary.has(key)) throw new AbpException(`An entity with the same key already exists in the collection: ${key}`);
    this.dictionary.set(key, this.memoryDbSerializer.serialize(entity));
  }

  update(entity: TEntity): void {
    const key = this.getEntityKey(entity);
    const stored = this.dictionary.get(key);
    if (stored === undefined) return;

    const originalEntity = this.memoryDbSerializer.deserialize(stored, this.entityType);
    if (hasConcurrencyStamp(entity) && hasConcurrencyStamp(originalEntity) && entity.concurrencyStamp !== originalEntity.concurrencyStamp) {
      throw new AbpDbConcurrencyException("Database operation expected to affect 1 row but actually affected 0 row. Data may have been modified or deleted since entities were loaded. This exception has been thrown on optimistic concurrency check.");
    }
    this.dictionary.set(key, this.memoryDbSerializer.serialize(entity));
  }

  remove(entity: TEntity): void {
    this.dictionary.delete(this.getEntityKey(entity));
  }

  private getEntityKey(entity: TEntity): string {
    return entity.getKeys().join(",");
  }
}

/** Port of `InMemoryIdGenerator`: sequential numbers per entity type, guids from the guid generator. */
export class InMemoryIdGenerator {
  private lastNumber = 0;

  constructor(private readonly guidGenerator: IGuidGenerator) {}

  generateNext(kind: "number" | "guid"): number | Guid {
    switch (kind) {
      case "number":
        return ++this.lastNumber;
      case "guid":
        return this.guidGenerator.create();
      default: {
        const _exhaustive: never = kind;
        throw new AbpException(`Not supported primary key kind: ${String(_exhaustive)}`);
      }
    }
  }
}

/** Port of `IMemoryDatabase`. */
export interface IMemoryDatabase {
  collection<TEntity extends IEntityBase>(entityType: AbstractClass<TEntity>): IMemoryDatabaseCollection<TEntity>;
  generateNextId(entityType: AbstractClass, kind: "number" | "guid"): number | Guid;
}
export const IMemoryDatabase = createToken<IMemoryDatabase>("IMemoryDatabase");

/** Port of `MemoryDatabase`: one collection per entity class, created on first use. */
@Transient(IMemoryDatabase)
export class MemoryDatabase implements IMemoryDatabase {
  static readonly inject = [IMemoryDbSerializer, IRootServiceProvider] as const;
  private readonly sets = new Map<AbstractClass, IMemoryDatabaseCollection<IEntityBase>>();
  private readonly entityIdGenerators = new Map<AbstractClass, InMemoryIdGenerator>();

  constructor(
    private readonly serializer: IMemoryDbSerializer,
    private readonly serviceProvider: IServiceProvider,
  ) {}

  collection<TEntity extends IEntityBase>(entityType: AbstractClass<TEntity>): IMemoryDatabaseCollection<TEntity> {
    let set = this.sets.get(entityType);
    if (!set) {
      set = new MemoryDatabaseCollection(entityType, this.serializer);
      this.sets.set(entityType, set);
    }
    return set as IMemoryDatabaseCollection<TEntity>;
  }

  generateNextId(entityType: AbstractClass, kind: "number" | "guid"): number | Guid {
    let generator = this.entityIdGenerators.get(entityType);
    if (!generator) {
      generator = new InMemoryIdGenerator(this.serviceProvider.get(IGuidGenerator) ?? SimpleGuidGenerator.instance);
      this.entityIdGenerators.set(entityType, generator);
    }
    return generator.generateNext(kind);
  }
}

/** Port of `MemoryDatabaseManager`: one database per connection string, for the life of the application. */
@Singleton()
export class MemoryDatabaseManager {
  static readonly inject = [IRootServiceProvider] as const;
  private readonly databases = new Map<string, IMemoryDatabase>();

  constructor(private readonly serviceProvider: IServiceProvider) {}

  get(databaseName: string): IMemoryDatabase {
    let database = this.databases.get(databaseName);
    if (!database) {
      database = this.serviceProvider.getRequired(IMemoryDatabase);
      this.databases.set(databaseName, database);
    }
    return database;
  }
}
