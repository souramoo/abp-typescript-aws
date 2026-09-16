import type { Guid } from "@abp/core";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { AbpDynamoDbConsts } from "./abp-dynamodb-consts.js";
import type { AbpDynamoDbOptions, DynamoDbIndexKey } from "./abp-dynamodb-options.js";
import type { DynamoDbEntityConfiguration, DynamoDbIndexConfiguration, DynamoDbKeyValue } from "./entity-configuration.js";

export interface DynamoDbItemKey {
  readonly pk: string;
  readonly sk: string;
}

export function keyString(id: unknown): string {
  return id instanceof Date ? id.toISOString() : String(id);
}

export function indexAttributeNames(index: DynamoDbIndexKey): { readonly pk: string; readonly sk: string } {
  return { pk: `${index}pk`, sk: `${index}sk` };
}

/** Attributes owned by the key layout (never handed to the entity serializer on read). */
export function reservedAttributeNames(options: AbpDynamoDbOptions): ReadonlySet<string> {
  const names = new Set<string>([AbpDynamoDbConsts.PartitionKeyAttribute, AbpDynamoDbConsts.SortKeyAttribute, AbpDynamoDbConsts.EntityTypeAttribute, options.ttlAttribute]);
  for (const index of ["gsi1", "gsi2", "gsi3"] as const) {
    const { pk, sk } = indexAttributeNames(index);
    names.add(pk);
    names.add(sk);
  }
  return names;
}

/**
 * The single-table key layout:
 * - `pk = <prefix><tenant|host>#<EntityName>#<id>`, `sk = <EntityName>` (point lookups)
 * - `gsi1pk = <prefix><tenant|host>#<EntityName>`, `gsi1sk = <creationTime ISO>#<id>` or `<id>` (list/paging)
 * - `gsi2`/`gsi3` from the entity configuration, scoped like `gsi1pk` unless configured otherwise.
 */
export class DynamoDbKeyBuilder {
  constructor(readonly options: AbpDynamoDbOptions) {}

  scopeOf(tenantId: Guid | null | undefined): string {
    return tenantId ?? AbpDynamoDbConsts.HostScope;
  }

  /** The key space an entity is written to: its own `tenantId` for multi-tenant entities, the host otherwise. */
  writeScope<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, entity: TEntity): string {
    if (!configuration.multiTenant) return AbpDynamoDbConsts.HostScope;
    return this.scopeOf(isMultiTenant(entity) ? entity.tenantId : undefined);
  }

  itemKey<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, scope: string, id: unknown): DynamoDbItemKey {
    return { pk: `${this.options.keyPrefix}${scope}#${configuration.name}#${keyString(id)}`, sk: configuration.name };
  }

  entityKey<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, entity: TEntity): DynamoDbItemKey {
    return this.itemKey(configuration, this.writeScope(configuration, entity), configuration.getKey(entity));
  }

  listPartitionKey<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, scope: string): string {
    return `${this.options.keyPrefix}${scope}#${configuration.name}`;
  }

  listSortKey<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, entity: TEntity): string {
    const id = keyString(configuration.getKey(entity));
    if (!configuration.creationTimeInSortKey) return id;
    const creationTime = (entity as { creationTime?: unknown }).creationTime;
    return `${creationTime instanceof Date ? creationTime.toISOString() : ""}#${id}`;
  }

  indexPartitionKey<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, scope: string, index: DynamoDbIndexConfiguration<TEntity>, value: DynamoDbKeyValue): string | undefined {
    if (value === undefined) return undefined;
    return index.scoped ? `${this.options.keyPrefix}${scope}#${configuration.name}#${value}` : String(value);
  }

  /** All index attributes of an item (`gsi1pk`/`gsi1sk` plus the configured `gsi2`/`gsi3` keys). */
  indexAttributes<TEntity extends object>(configuration: DynamoDbEntityConfiguration<TEntity>, scope: string, entity: TEntity): Record<string, string> {
    const list = indexAttributeNames("gsi1");
    const attributes: Record<string, string> = { [list.pk]: this.listPartitionKey(configuration, scope), [list.sk]: this.listSortKey(configuration, entity) };
    for (const index of configuration.indexes) {
      const pk = this.indexPartitionKey(configuration, scope, index, index.pk(entity));
      if (pk === undefined) continue;
      const names = indexAttributeNames(index.index);
      const sk = index.sk(entity);
      attributes[names.pk] = pk;
      attributes[names.sk] = sk === undefined ? keyString(configuration.getKey(entity)) : String(sk);
    }
    return attributes;
  }

  indexName(index: DynamoDbIndexKey): string {
    return this.options.indexNames[index];
  }
}
