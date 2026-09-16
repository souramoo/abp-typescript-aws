import type { QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { AbpException } from "@abp/core";
import { QueryableBase, executeQueryPlan, type QueryPlan, type SortDirection } from "@abp/ddd-domain";
import type { DynamoDbIndexKey } from "./abp-dynamodb-options.js";
import type { DynamoDbDatabase } from "./dynamodb-database.js";
import type { DynamoDbItem } from "./dynamodb-entity-serializer.js";
import { indexAttributeNames } from "./dynamodb-keys.js";
import type { DynamoDbEntityConfiguration, DynamoDbKeyValue } from "./entity-configuration.js";

/** Sort-key condition of an index query (`KeyConditionExpression` on `gsiNsk`). */
export interface DynamoDbSortKeyCondition {
  eq?: string;
  beginsWith?: string;
  between?: readonly [string, string];
  lt?: string;
  lte?: string;
  gt?: string;
  gte?: string;
}

export interface DynamoDbIndexQuery {
  readonly index: DynamoDbIndexKey;
  readonly partitionKey: string;
  readonly sortKey: DynamoDbSortKeyCondition | undefined;
  /** Lower-cased property names whose single-clause ordering maps onto the index sort key. */
  readonly nativeOrderKeys: readonly string[];
}

export interface DynamoDbQuerySource<TEntity extends object> {
  readonly database: DynamoDbDatabase;
  readonly configuration: DynamoDbEntityConfiguration<TEntity>;
  /** The tenant (or host) key space read from. */
  readonly scope: string;
  readonly softDeleteFilter: boolean;
  toEntity(item: DynamoDbItem): TEntity;
}

export type DynamoDbPageKey = Record<string, unknown>;

export interface DynamoDbPage<TEntity> {
  readonly items: TEntity[];
  /** Pass as `exclusiveStartKey` of the next call; undefined when the partition is exhausted. */
  readonly lastEvaluatedKey: DynamoDbPageKey | undefined;
}

interface FetchResult {
  readonly items: DynamoDbItem[];
  readonly lastEvaluatedKey: DynamoDbPageKey | undefined;
}

function defaultIndexQuery<TEntity extends object>(source: DynamoDbQuerySource<TEntity>): DynamoDbIndexQuery {
  const { configuration } = source;
  return {
    index: "gsi1",
    partitionKey: source.database.keyBuilder.listPartitionKey(configuration, source.scope),
    sortKey: undefined,
    nativeOrderKeys: configuration.creationTimeInSortKey ? ["creationtime"] : [configuration.keyProperty.toLowerCase()],
  };
}

/**
 * `IQueryable<T>` over one partition of an index. DynamoDB cannot evaluate JavaScript predicates, so a plan with
 * predicates (or an ordering the index does not provide) fetches the whole partition and is evaluated in memory;
 * plans without predicates page natively (`Limit`/`ExclusiveStartKey`) and count with `Select COUNT`.
 * `usingIndex` switches to a configured `gsi2`/`gsi3` partition for efficient lookups.
 */
export class DynamoDbQueryable<TEntity extends object> extends QueryableBase<TEntity> {
  private readonly indexQuery: DynamoDbIndexQuery;

  constructor(
    private readonly source: DynamoDbQuerySource<TEntity>,
    plan?: QueryPlan<TEntity>,
    indexQuery?: DynamoDbIndexQuery,
  ) {
    super(plan);
    this.indexQuery = indexQuery ?? defaultIndexQuery(source);
  }

  /** Queries the configured index with the logical partition key value (scoped like the stored keys) and an optional sort-key condition. */
  usingIndex(index: DynamoDbIndexKey, partitionKey: Exclude<DynamoDbKeyValue, undefined>, sortKey?: DynamoDbSortKeyCondition): DynamoDbQueryable<TEntity> {
    const { configuration, database, scope } = this.source;
    const indexConfiguration = configuration.indexes.find((i) => i.index === index);
    if (!indexConfiguration) throw new AbpException(`Index ${index} is not configured for ${configuration.name}. Configure it with builder.entity(${configuration.entityType.name}, e => e.index("${index}", ...)).`);
    const resolved = database.keyBuilder.indexPartitionKey(configuration, scope, indexConfiguration, partitionKey);
    if (resolved === undefined) throw new AbpException("The index partition key value must not be undefined.");
    return new DynamoDbQueryable(this.source, this.plan, { index, partitionKey: resolved, sortKey, nativeOrderKeys: [] });
  }

  /** One page of the partition (plans with predicates cannot page natively and throw). */
  async toPage(limit: number, exclusiveStartKey?: DynamoDbPageKey, forward = true, signal?: AbortSignal): Promise<DynamoDbPage<TEntity>> {
    if (this.plan.predicates.length > 0) throw new AbpException("toPage() is only available for queries without predicates; DynamoDB pages are keyed, not offset based.");
    const response = await this.source.database.query(this.buildQueryInput(forward, limit, exclusiveStartKey), signal);
    return { items: (response.Items ?? []).map((item) => this.source.toEntity(item)), lastEvaluatedKey: response.LastEvaluatedKey };
  }

  override async count(signal?: AbortSignal): Promise<number> {
    if (this.plan.predicates.length === 0 && this.plan.skipCount === undefined && this.plan.takeCount === undefined) return this.countNative(signal);
    return super.count(signal);
  }

  protected withPlan(plan: QueryPlan<TEntity>): DynamoDbQueryable<TEntity> {
    return new DynamoDbQueryable(this.source, plan, this.indexQuery);
  }

  protected async executePlan(plan: QueryPlan<TEntity>, signal?: AbortSignal): Promise<TEntity[]> {
    const direction = this.nativeDirection(plan);
    if (plan.predicates.length === 0 && direction !== undefined) {
      const skip = Math.max(0, plan.skipCount ?? 0);
      const take = plan.takeCount === undefined ? undefined : Math.max(0, plan.takeCount);
      if (take === 0) return [];
      const fetched = await this.fetch(direction === "asc", take === undefined ? undefined : skip + take, signal);
      return fetched.items.slice(skip, take === undefined ? undefined : skip + take).map((item) => this.source.toEntity(item));
    }
    const fetched = await this.fetch(true, undefined, signal);
    return executeQueryPlan(
      fetched.items.map((item) => this.source.toEntity(item)),
      plan,
    );
  }

  private nativeDirection(plan: QueryPlan<TEntity>): SortDirection | undefined {
    if (plan.ordering.length === 0) return "asc";
    if (plan.ordering.length !== 1) return undefined;
    const clause = plan.ordering[0]!;
    if (typeof clause.key !== "string" || !this.indexQuery.nativeOrderKeys.includes(clause.key.toLowerCase())) return undefined;
    return clause.direction;
  }

  private async fetch(forward: boolean, limit: number | undefined, signal: AbortSignal | undefined): Promise<FetchResult> {
    const items: DynamoDbItem[] = [];
    let startKey: DynamoDbPageKey | undefined = undefined;
    do {
      const remaining = limit === undefined ? undefined : limit - items.length;
      const response = await this.source.database.query(this.buildQueryInput(forward, remaining, startKey), signal);
      items.push(...(response.Items ?? []));
      startKey = response.LastEvaluatedKey;
    } while (startKey !== undefined && (limit === undefined || items.length < limit));
    return { items, lastEvaluatedKey: startKey };
  }

  private async countNative(signal: AbortSignal | undefined): Promise<number> {
    let count = 0;
    let startKey: DynamoDbPageKey | undefined = undefined;
    do {
      const response = await this.source.database.query({ ...this.buildQueryInput(true, undefined, startKey), Select: "COUNT" }, signal);
      count += response.Count ?? 0;
      startKey = response.LastEvaluatedKey;
    } while (startKey !== undefined);
    return count;
  }

  private buildQueryInput(forward: boolean, limit: number | undefined, exclusiveStartKey: DynamoDbPageKey | undefined): Omit<QueryCommandInput, "TableName"> {
    const { index, partitionKey, sortKey } = this.indexQuery;
    const attributes = indexAttributeNames(index);
    const names: Record<string, string> = { "#pk": attributes.pk };
    const values: Record<string, unknown> = { ":pk": partitionKey };
    const keyConditions = ["#pk = :pk"];
    const sortCondition = sortKeyCondition(sortKey, names, values, attributes.sk);
    if (sortCondition) keyConditions.push(sortCondition);

    let filterExpression: string | undefined;
    if (this.source.softDeleteFilter) {
      names["#isDeleted"] = "isDeleted";
      values[":notDeleted"] = false;
      filterExpression = "attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted";
    }

    return {
      IndexName: this.source.database.keyBuilder.indexName(index),
      KeyConditionExpression: keyConditions.join(" AND "),
      FilterExpression: filterExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ScanIndexForward: forward,
      Limit: limit === undefined ? undefined : Math.max(1, limit),
      ExclusiveStartKey: exclusiveStartKey,
    };
  }
}

function sortKeyCondition(sortKey: DynamoDbSortKeyCondition | undefined, names: Record<string, string>, values: Record<string, unknown>, attribute: string): string | undefined {
  if (!sortKey) return undefined;
  names["#sk"] = attribute;
  if (sortKey.eq !== undefined) {
    values[":sk"] = sortKey.eq;
    return "#sk = :sk";
  }
  if (sortKey.beginsWith !== undefined) {
    values[":sk"] = sortKey.beginsWith;
    return "begins_with(#sk, :sk)";
  }
  if (sortKey.between !== undefined) {
    values[":skFrom"] = sortKey.between[0];
    values[":skTo"] = sortKey.between[1];
    return "#sk BETWEEN :skFrom AND :skTo";
  }
  const comparisons: [keyof DynamoDbSortKeyCondition, string][] = [
    ["lt", "<"],
    ["lte", "<="],
    ["gt", ">"],
    ["gte", ">="],
  ];
  for (const [key, operator] of comparisons) {
    const value = sortKey[key];
    if (value !== undefined) {
      values[":sk"] = value;
      return `#sk ${operator} :sk`;
    }
  }
  return undefined;
}
