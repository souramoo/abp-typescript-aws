import type { Guid } from "@abp/core";
import { DynamoDbRepository, dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "@abp/dynamodb";
import { isPredicate, type EntityPredicate } from "@abp/ddd-domain";
import type { ITenantRepository} from "../domain/index.js";
import { Tenant, applyTenantFilter, applyTenantListPaging, isTenantListQueryCall } from "../domain/index.js";
import { TenantManagementDbContext } from "./tenant-management-db-context.js";

/** Port of `MongoTenantRepository`: `findByName` queries `gsi2`; the filtered list is evaluated over the host partition. */
export class DynamoDbTenantRepository extends DynamoDbRepository<TenantManagementDbContext, Tenant, Guid> implements ITenantRepository {
  static readonly inject = [dynamoDbContextProviderToken(TenantManagementDbContext)] as const;

  constructor(dbContextProvider: IDynamoDbContextProvider<TenantManagementDbContext>) {
    super(dbContextProvider, Tenant);
  }

  async findByName(normalizedName: string, _includeDetails = true, signal?: AbortSignal): Promise<Tenant | undefined> {
    return (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", normalizedName).firstOrDefault(signal);
  }

  override getList(includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]>;
  override getList(predicate: EntityPredicate<Tenant>, includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]>;
  override getList(sorting: string | null | undefined, maxResultCount?: number, skipCount?: number, filter?: string | null, includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]>;
  override async getList(first?: boolean | EntityPredicate<Tenant> | string | null, second?: boolean | AbortSignal | number, third?: AbortSignal | number, filter?: string | null, _includeDetails?: boolean, signal?: AbortSignal): Promise<Tenant[]> {
    if (isTenantListQueryCall(first, second)) {
      const query = applyTenantFilter(await this.getQueryable(), filter);
      return applyTenantListPaging(query, first as string | null | undefined, typeof second === "number" ? second : Number.MAX_SAFE_INTEGER, typeof third === "number" ? third : 0).toList(signal);
    }
    if (isPredicate<Tenant>(first)) return super.getList(first, second as boolean | undefined, third as AbortSignal | undefined);
    return super.getList(first as boolean | undefined, second as boolean | AbortSignal | undefined, third as AbortSignal | undefined);
  }

  override getCount(signal?: AbortSignal): Promise<number>;
  override getCount(filter: string | null | undefined, signal?: AbortSignal): Promise<number>;
  override async getCount(first?: AbortSignal | string | null, signal?: AbortSignal): Promise<number> {
    if (first instanceof AbortSignal) return super.getCount(first);
    return applyTenantFilter(await this.getQueryable(), first).count(signal);
  }
}
