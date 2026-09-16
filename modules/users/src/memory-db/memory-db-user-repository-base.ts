import { isNullOrEmptyString, type AbstractClass, type Guid } from "@abp/core";
import { keysEqual } from "@abp/ddd-domain";
import { MemoryDbRepository, type IMemoryDatabaseProvider, type MemoryDbContext } from "@abp/memory-db";
import { DefaultUserSorting, matchesUserSearchFilter, type IUser, type IUserRepository } from "../domain/index.js";

/** The in-memory counterpart of `DynamoDbUserRepositoryBase` for tests (port of `MongoUserRepositoryBase` on `MemoryDbRepository`). */
export abstract class MemoryDbUserRepositoryBase<TDbContext extends MemoryDbContext, TUser extends IUser> extends MemoryDbRepository<TDbContext, TUser, Guid> implements IUserRepository<TUser> {
  protected constructor(databaseProvider: IMemoryDatabaseProvider<TDbContext>, entityType: AbstractClass<TUser>) {
    super(databaseProvider, entityType);
  }

  async findByUserName(userName: string, signal?: AbortSignal): Promise<TUser | undefined> {
    return (await this.getQueryable()).where((u) => u.userName === userName).orderBy("id").firstOrDefault(signal);
  }

  async getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<TUser[]> {
    const idList = [...ids];
    return (await this.getQueryable()).where((u) => idList.some((id) => keysEqual(id, u.id))).toList(signal);
  }

  async search(sorting?: string, maxResultCount = Number.MAX_SAFE_INTEGER, skipCount = 0, filter?: string, signal?: AbortSignal): Promise<TUser[]> {
    return (await this.getQueryable())
      .where((u) => matchesUserSearchFilter(u, filter))
      .orderBySorting(isNullOrEmptyString(sorting) ? DefaultUserSorting : sorting)
      .skip(skipCount)
      .take(maxResultCount)
      .toList(signal);
  }

  override async getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number> {
    const filter = typeof filterOrSignal === "string" ? filterOrSignal : undefined;
    const abortSignal = filterOrSignal instanceof AbortSignal ? filterOrSignal : signal;
    const query = await this.getQueryable();
    if (isNullOrEmptyString(filter)) return query.count(abortSignal);
    return query.where((u) => matchesUserSearchFilter(u, filter)).count(abortSignal);
  }
}
