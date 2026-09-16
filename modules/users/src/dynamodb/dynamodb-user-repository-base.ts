import { isNullOrEmptyString, type AbstractClass, type Guid } from "@abp/core";
import { keysEqual } from "@abp/ddd-domain";
import { DynamoDbRepository, type AbpDynamoDbContext, type DynamoDbIndexKey, type IDynamoDbContextProvider } from "@abp/dynamodb";
import { DefaultUserSorting, matchesUserSearchFilter, type IUser, type IUserRepository } from "../domain/index.js";

/**
 * Port of `MongoUserRepositoryBase<TDbContext, TUser>` on DynamoDB. Point lookups use the index the db context
 * configured for the entity: `gsi2` keyed by the user name ({@link DynamoDbUserRepositoryBase.UserNameIndex}) and
 * `gsi3` keyed by the email ({@link DynamoDbUserRepositoryBase.EmailIndex}); without the index the lookup filters
 * the entity partition. Subclasses declare `static readonly inject = [dynamoDbContextProviderToken(MyDbContext)] as const`.
 */
export abstract class DynamoDbUserRepositoryBase<TDbContext extends AbpDynamoDbContext, TUser extends IUser> extends DynamoDbRepository<TDbContext, TUser, Guid> implements IUserRepository<TUser> {
  static readonly UserNameIndex: DynamoDbIndexKey = "gsi2";
  static readonly EmailIndex: DynamoDbIndexKey = "gsi3";

  protected constructor(dbContextProvider: IDynamoDbContextProvider<TDbContext>, entityType: AbstractClass<TUser>) {
    super(dbContextProvider, entityType);
  }

  async findByUserName(userName: string, signal?: AbortSignal): Promise<TUser | undefined> {
    return this.findFirstByIndexedValue(DynamoDbUserRepositoryBase.UserNameIndex, this.userNameIndexValue(userName), (u) => u.userName === userName, signal);
  }

  async getListByIds(ids: Iterable<Guid>, signal?: AbortSignal): Promise<TUser[]> {
    const idList = [...ids];
    return (await this.getDynamoDbQueryable(signal)).where((u) => idList.some((id) => keysEqual(id, u.id))).toList(signal);
  }

  async search(sorting?: string, maxResultCount = Number.MAX_SAFE_INTEGER, skipCount = 0, filter?: string, signal?: AbortSignal): Promise<TUser[]> {
    return (await this.getDynamoDbQueryable(signal))
      .where((u) => matchesUserSearchFilter(u, filter))
      .orderBySorting(isNullOrEmptyString(sorting) ? DefaultUserSorting : sorting)
      .skip(skipCount)
      .take(maxResultCount)
      .toList(signal);
  }

  override async getCount(filterOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<number> {
    const filter = typeof filterOrSignal === "string" ? filterOrSignal : undefined;
    const abortSignal = filterOrSignal instanceof AbortSignal ? filterOrSignal : signal;
    const query = await this.getDynamoDbQueryable(abortSignal);
    if (isNullOrEmptyString(filter)) return query.count(abortSignal);
    return query.where((u) => matchesUserSearchFilter(u, filter)).count(abortSignal);
  }

  /** The value stored in the user-name index partition; override when the index is keyed by the normalized user name. */
  protected userNameIndexValue(userName: string): string {
    return userName;
  }

  /** The value stored in the email index partition; override when the index is keyed by the normalized email. */
  protected emailIndexValue(email: string): string {
    return email;
  }

  /** First user of the index partition ordered by id (`OrderBy(x => x.Id).FirstOrDefault`); filters the entity partition when the index is not configured. */
  protected async findFirstByIndexedValue(index: DynamoDbIndexKey, value: string, fallback: (user: TUser) => boolean, signal?: AbortSignal): Promise<TUser | undefined> {
    const query = await this.getDynamoDbQueryable(signal);
    const indexed = (await this.getEntityConfiguration(signal)).indexes.some((i) => i.index === index);
    return (indexed ? query.usingIndex(index, value) : query.where(fallback)).orderBy("id").firstOrDefault(signal);
  }
}
