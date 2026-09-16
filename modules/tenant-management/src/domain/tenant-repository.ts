import { createToken, isNullOrWhiteSpace, type Guid } from "@abp/core";
import type { EntityPredicate, IQueryable, IRepository } from "@abp/ddd-domain";
import type { Tenant } from "./tenant.js";

/**
 * Port of `ITenantRepository` (`IBasicRepository<Tenant, Guid>` in .NET; the full `IRepository` here since every
 * provider of this port implements it). The `GetListAsync`/`GetCountAsync` overloads keep their names and are
 * distinguished by argument type.
 */
export interface ITenantRepository extends IRepository<Tenant, Guid> {
  findByName(normalizedName: string, includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant | undefined>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]>;
  getList(predicate: EntityPredicate<Tenant>, includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]>;
  /** Port of `GetListAsync(sorting, maxResultCount, skipCount, filter, includeDetails)`: sorted by `name` when `sorting` is empty. */
  getList(sorting: string | null | undefined, maxResultCount?: number, skipCount?: number, filter?: string | null, includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]>;
  getCount(signal?: AbortSignal): Promise<number>;
  /** Port of `GetCountAsync(filter)`. */
  getCount(filter: string | null | undefined, signal?: AbortSignal): Promise<number>;
}
export const ITenantRepository = createToken<ITenantRepository>("ITenantRepository");

/** The `WhereIf(!filter.IsNullOrWhiteSpace(), u => u.Name.Contains(filter))` clause shared by the repository implementations. */
export function applyTenantFilter(query: IQueryable<Tenant>, filter: string | null | undefined): IQueryable<Tenant> {
  if (isNullOrWhiteSpace(filter)) return query;
  return query.where((tenant) => tenant.name.includes(filter));
}

/** The `OrderBy(sorting ?? "Name").PageBy(skip, max)` tail of `GetListAsync`. */
export function applyTenantListPaging(query: IQueryable<Tenant>, sorting: string | null | undefined, maxResultCount: number, skipCount: number): IQueryable<Tenant> {
  return query
    .orderBySorting(isNullOrWhiteSpace(sorting) ? "name" : sorting)
    .skip(skipCount)
    .take(maxResultCount);
}

/** True when a `getList` call uses the custom `(sorting, maxResultCount, skipCount, filter, ...)` overload. */
export function isTenantListQueryCall(first: unknown, second: unknown): boolean {
  return typeof first === "string" || first === null || (first === undefined && (typeof second === "number" || typeof second === "string"));
}
