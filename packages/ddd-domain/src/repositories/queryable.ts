import { AbpException, isNullOrWhiteSpace, toCamelCase } from "@abp/core";
import type { ISpecification } from "@abp/specifications";

/** Port of `Expression<Func<T, bool>>`: a plain predicate. */
export type Predicate<T> = (entity: T) => boolean;
/** What repository/query methods accept as a filter. */
export type EntityPredicate<T> = Predicate<T> | ISpecification<T>;
export type SortDirection = "asc" | "desc";
/** A property name (matched exactly, then case-insensitively) or a selector. */
export type SortKey<T> = string | ((entity: T) => unknown);

export interface OrderClause<T> {
  readonly key: SortKey<T>;
  readonly direction: SortDirection;
}

/** The immutable description of a query; providers translate or evaluate it. */
export interface QueryPlan<T> {
  readonly predicates: readonly Predicate<T>[];
  readonly ordering: readonly OrderClause<T>[];
  readonly skipCount: number | undefined;
  readonly takeCount: number | undefined;
}

/**
 * Replacement for LINQ `IQueryable<T>`: a small immutable query builder. Builder calls return a new query; the
 * terminal calls (`toList`, `count`, …) execute it. `count`/`any` honour `skip`/`take` like LINQ does.
 */
export interface IQueryable<T> {
  readonly plan: QueryPlan<T>;
  where(predicate: EntityPredicate<T>): IQueryable<T>;
  /** Replaces the ordering (LINQ `OrderBy`). */
  orderBy(key: SortKey<T>, direction?: SortDirection): IQueryable<T>;
  /** Appends a secondary ordering (LINQ `ThenBy`). */
  thenBy(key: SortKey<T>, direction?: SortDirection): IQueryable<T>;
  /** Port of Dynamic LINQ `OrderBy("Name DESC, Age")`; an empty string leaves the query unchanged. */
  orderBySorting(sorting: string | null | undefined): IQueryable<T>;
  skip(count: number): IQueryable<T>;
  take(count: number): IQueryable<T>;
  toList(signal?: AbortSignal): Promise<T[]>;
  count(signal?: AbortSignal): Promise<number>;
  any(signal?: AbortSignal): Promise<boolean>;
  /** Throws `AbpException` when the query has no element (LINQ `First`). */
  first(signal?: AbortSignal): Promise<T>;
  firstOrDefault(signal?: AbortSignal): Promise<T | undefined>;
  /** Throws `AbpException` when the query has no or more than one element (LINQ `Single`). */
  single(signal?: AbortSignal): Promise<T>;
  /** Throws `AbpException` when the query has more than one element (LINQ `SingleOrDefault`). */
  singleOrDefault(signal?: AbortSignal): Promise<T | undefined>;
}

export function toPredicate<T>(predicate: EntityPredicate<T>): Predicate<T> {
  return typeof predicate === "function" ? predicate : predicate.toExpression();
}

/** Port of the sorting string grammar of Dynamic LINQ as used by ABP: `"Name"`, `"Name DESC"`, `"Name ASC, Age DESC"`. */
export interface SortClause {
  readonly field: string;
  readonly direction: SortDirection;
}

export function parseSorting(sorting: string | null | undefined): SortClause[] {
  if (isNullOrWhiteSpace(sorting)) return [];
  return sorting
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const tokens = part.split(/\s+/);
      const field = tokens[0]!;
      const directionToken = tokens[1]?.toLowerCase();
      if (tokens.length > 2 || (directionToken !== undefined && directionToken !== "asc" && directionToken !== "desc")) {
        throw new AbpException(`Invalid sorting expression: '${part}'. Expected '<field> [ASC|DESC]'.`);
      }
      return { field, direction: directionToken === "desc" ? "desc" : "asc" };
    });
}

/** Reads a sort key from an object: exact property name first, then the camelCase form of a PascalCase name. */
export function readSortValue(entity: unknown, key: SortKey<never>): unknown {
  if (typeof key === "function") return (key as (e: unknown) => unknown)(entity);
  if (entity === null || typeof entity !== "object") return undefined;
  const record = entity as Record<string, unknown>;
  if (key in record) return record[key];
  const camel = toCamelCase(key);
  if (camel in record) return record[camel];
  const lower = key.toLowerCase();
  const found = Object.keys(record).find((k) => k.toLowerCase() === lower);
  return found === undefined ? undefined : record[found];
}

/** SQL-like comparison: nulls first, numbers/dates/bigints numerically, booleans false-first, everything else as text. */
export function compareSortValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Evaluates a query plan against in-memory items (used by `ArrayQueryable`; providers may reuse it after a scan). */
export function executeQueryPlan<T>(items: Iterable<T>, plan: QueryPlan<T>): T[] {
  let result = [...items];
  for (const predicate of plan.predicates) result = result.filter(predicate);
  if (plan.ordering.length > 0) {
    const ordering = plan.ordering;
    result = result
      .map((item, index) => ({ item, index }))
      .sort((x, y) => {
        for (const clause of ordering) {
          const cmp = compareSortValues(readSortValue(x.item, clause.key), readSortValue(y.item, clause.key));
          if (cmp !== 0) return clause.direction === "desc" ? -cmp : cmp;
        }
        return x.index - y.index;
      })
      .map((x) => x.item);
  }
  if (plan.skipCount !== undefined && plan.skipCount > 0) result = result.slice(plan.skipCount);
  if (plan.takeCount !== undefined) result = result.slice(0, Math.max(0, plan.takeCount));
  return result;
}

export const emptyQueryPlan: QueryPlan<never> = { predicates: [], ordering: [], skipCount: undefined, takeCount: undefined };

/**
 * Base class for `IQueryable<T>` implementations: keeps the plan immutable and derives every terminal operation from
 * `executePlan`. Providers override `countPlan` etc. when the store can do better than materialising.
 */
export abstract class QueryableBase<T> implements IQueryable<T> {
  constructor(readonly plan: QueryPlan<T> = emptyQueryPlan as QueryPlan<T>) {}

  protected abstract withPlan(plan: QueryPlan<T>): IQueryable<T>;
  protected abstract executePlan(plan: QueryPlan<T>, signal?: AbortSignal): Promise<T[]>;

  where(predicate: EntityPredicate<T>): IQueryable<T> {
    return this.withPlan({ ...this.plan, predicates: [...this.plan.predicates, toPredicate(predicate)] });
  }

  orderBy(key: SortKey<T>, direction: SortDirection = "asc"): IQueryable<T> {
    return this.withPlan({ ...this.plan, ordering: [{ key, direction }] });
  }

  thenBy(key: SortKey<T>, direction: SortDirection = "asc"): IQueryable<T> {
    return this.withPlan({ ...this.plan, ordering: [...this.plan.ordering, { key, direction }] });
  }

  orderBySorting(sorting: string | null | undefined): IQueryable<T> {
    const clauses = parseSorting(sorting);
    if (clauses.length === 0) return this;
    return this.withPlan({ ...this.plan, ordering: clauses.map((c) => ({ key: c.field, direction: c.direction })) });
  }

  skip(count: number): IQueryable<T> {
    return this.withPlan({ ...this.plan, skipCount: count });
  }

  take(count: number): IQueryable<T> {
    return this.withPlan({ ...this.plan, takeCount: count });
  }

  toList(signal?: AbortSignal): Promise<T[]> {
    return this.executePlan(this.plan, signal);
  }

  async count(signal?: AbortSignal): Promise<number> {
    return (await this.executePlan(this.plan, signal)).length;
  }

  async any(signal?: AbortSignal): Promise<boolean> {
    return (await this.executePlan({ ...this.plan, takeCount: this.plan.takeCount === undefined ? 1 : Math.min(1, this.plan.takeCount) }, signal)).length > 0;
  }

  async first(signal?: AbortSignal): Promise<T> {
    const item = await this.firstOrDefault(signal);
    if (item === undefined) throw new AbpException("Sequence contains no elements.");
    return item;
  }

  async firstOrDefault(signal?: AbortSignal): Promise<T | undefined> {
    const items = await this.executePlan({ ...this.plan, takeCount: this.plan.takeCount === undefined ? 1 : Math.min(1, this.plan.takeCount) }, signal);
    return items[0];
  }

  async single(signal?: AbortSignal): Promise<T> {
    const item = await this.singleOrDefault(signal);
    if (item === undefined) throw new AbpException("Sequence contains no elements.");
    return item;
  }

  async singleOrDefault(signal?: AbortSignal): Promise<T | undefined> {
    const items = await this.executePlan({ ...this.plan, takeCount: this.plan.takeCount === undefined ? 2 : Math.min(2, this.plan.takeCount) }, signal);
    if (items.length > 1) throw new AbpException("Sequence contains more than one element.");
    return items[0];
  }
}

export type QuerySource<T> = Iterable<T> | (() => Iterable<T> | Promise<Iterable<T>>);

/** `IQueryable<T>` over an array (or a lazily produced one); the `IEnumerable.AsQueryable()` of this port. */
export class ArrayQueryable<T> extends QueryableBase<T> {
  constructor(
    private readonly source: QuerySource<T>,
    plan?: QueryPlan<T>,
  ) {
    super(plan);
  }

  static from<T>(source: QuerySource<T>): ArrayQueryable<T> {
    return new ArrayQueryable(source);
  }

  protected withPlan(plan: QueryPlan<T>): IQueryable<T> {
    return new ArrayQueryable(this.source, plan);
  }

  protected async executePlan(plan: QueryPlan<T>): Promise<T[]> {
    const items = typeof this.source === "function" ? await this.source() : this.source;
    return executeQueryPlan(items, plan);
  }
}
