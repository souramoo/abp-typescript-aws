import { Transient, createToken, type AbstractClass } from "@abp/core";
import { ExtraPropertyDictionary } from "@abp/object-extending";
import { AbpDynamoDbConsts } from "./abp-dynamodb-consts.js";

export type DynamoDbItem = Record<string, unknown>;

/**
 * Port of `IMemoryDbSerializer`/BSON class maps for DynamoDB items: entities become JSON-safe attribute maps and are
 * revived with their class prototype. A `__types` attribute records which paths held `Date`, `Map`, `Set`, `bigint`
 * or `ExtraPropertyDictionary` values.
 */
export interface IDynamoDbEntitySerializer {
  serialize(entity: object): DynamoDbItem;
  deserialize<TEntity extends object>(item: DynamoDbItem, entityType: AbstractClass<TEntity>): TEntity;
}
export const IDynamoDbEntitySerializer = createToken<IDynamoDbEntitySerializer>("IDynamoDbEntitySerializer");

type TypeTag = "date" | "bigint" | "extraProperties" | "map" | "set";
type TypeMap = Record<string, TypeTag>;

function join(path: string, segment: string | number): string {
  return path === "" ? String(segment) : `${path}.${segment}`;
}

function isTypeMap(value: unknown): value is TypeMap {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `undefined` fields are stored as `NULL` and revived as `undefined`, so audit fields such as `creatorId` keep existing
 * on the revived instance (ABP detects them by presence). A stored `null` therefore also comes back as `undefined`.
 */
@Transient(IDynamoDbEntitySerializer)
export class DefaultDynamoDbEntitySerializer implements IDynamoDbEntitySerializer {
  serialize(entity: object): DynamoDbItem {
    const types: TypeMap = {};
    const attributes = this.writeObject(entity as Record<string, unknown>, "", types);
    if (Object.keys(types).length > 0) attributes[AbpDynamoDbConsts.TypesAttribute] = types;
    return attributes;
  }

  deserialize<TEntity extends object>(item: DynamoDbItem, entityType: AbstractClass<TEntity>): TEntity {
    const { [AbpDynamoDbConsts.TypesAttribute]: rawTypes, ...attributes } = item;
    const types = isTypeMap(rawTypes) ? rawTypes : {};
    const instance = Object.create(entityType.prototype as object) as Record<string, unknown>;
    for (const [key, value] of Object.entries(attributes)) instance[key] = this.read(value, key, types);
    return instance as TEntity;
  }

  protected write(value: unknown, path: string, types: TypeMap): unknown {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) {
      types[path] = "date";
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === "bigint") {
      types[path] = "bigint";
      return value.toString();
    }
    if (typeof value !== "object") return typeof value === "function" ? null : value;
    if (value instanceof ExtraPropertyDictionary) {
      types[path] = "extraProperties";
      return this.writeObject(value.toObject(), path, types);
    }
    if (value instanceof Map) {
      types[path] = "map";
      return [...value].map(([k, v], i) => [this.write(k, join(path, `${i}.0`), types), this.write(v, join(path, `${i}.1`), types)]);
    }
    if (value instanceof Set) {
      types[path] = "set";
      return [...value].map((v, i) => this.write(v, join(path, i), types));
    }
    if (Array.isArray(value)) return value.map((v, i) => this.write(v, join(path, i), types));
    return this.writeObject(value as Record<string, unknown>, path, types);
  }

  protected writeObject(source: Record<string, unknown>, path: string, types: TypeMap): DynamoDbItem {
    const result: DynamoDbItem = {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "function") continue;
      result[key] = this.write(value, join(path, key), types);
    }
    return result;
  }

  protected read(value: unknown, path: string, types: TypeMap): unknown {
    if (value === undefined || value === null) return undefined;
    const tag = types[path];
    switch (tag) {
      case "date":
        return new Date(String(value));
      case "bigint":
        return BigInt(String(value));
      case "extraProperties":
        return new ExtraPropertyDictionary(this.readObject(value, path, types));
      case "map":
        return new Map(Array.isArray(value) ? value.map((pair, i) => this.readPair(pair, join(path, i), types)) : []);
      case "set":
        return new Set(Array.isArray(value) ? value.map((v, i) => this.read(v, join(path, i), types)) : []);
      case undefined:
        break;
      default: {
        const _exhaustive: never = tag;
        return _exhaustive;
      }
    }
    if (Array.isArray(value)) return value.map((v, i) => this.read(v, join(path, i), types));
    if (isRecord(value)) return this.readObject(value, path, types);
    return value;
  }

  private readObject(value: unknown, path: string, types: TypeMap): Record<string, unknown> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.read(v, join(path, k), types)]));
  }

  private readPair(pair: unknown, path: string, types: TypeMap): [unknown, unknown] {
    if (!Array.isArray(pair)) return [undefined, undefined];
    return [this.read(pair[0], join(path, 0), types), this.read(pair[1], join(path, 1), types)];
  }
}
