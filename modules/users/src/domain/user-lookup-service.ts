import { ILoggerFactory, NullLogger, createToken, keyedToken, type AbstractClass, type Guid, type IAbpLazyServiceProvider, type ILogger, type ServiceKey, type ServiceToken } from "@abp/core";
import { EntityNotFoundException } from "@abp/ddd-domain";
import { IUnitOfWorkManager } from "@abp/uow";
import { IExternalUserLookupServiceProvider, type IUserData } from "../domain-shared/index.js";
import { isUpdateUserData, toAbpUserData, type IUser } from "./user.js";
import type { IUserRepository } from "./user-repository.js";

/** Port of `IUserLookupService<TUser>`. */
export interface IUserLookupService<TUser extends IUser> {
  findById(id: Guid, signal?: AbortSignal): Promise<TUser | undefined>;
  findByUserName(userName: string, signal?: AbortSignal): Promise<TUser | undefined>;
  search(sorting?: string, filter?: string, maxResultCount?: number, skipCount?: number, signal?: AbortSignal): Promise<IUserData[]>;
  getCount(filter?: string, signal?: AbortSignal): Promise<number>;
}

const IUserLookupServiceBase = createToken<unknown>("IUserLookupService");

/** The token of `IUserLookupService<TUser>` for a user class (stable per class). */
export function userLookupServiceToken<TUser extends IUser>(userType: AbstractClass<TUser>): ServiceToken<IUserLookupService<TUser>> {
  return keyedToken<IUserLookupService<TUser>>(IUserLookupServiceBase, userType);
}

/**
 * Port of `UserLookupService<TUser, TUserRepository>`: local users first, optionally synchronised with an
 * `IExternalUserLookupServiceProvider` (property-injected in .NET; resolved lazily here and overridable through the
 * setter). Concrete subclasses declare `static readonly inject = [IMyUserRepository, IUnitOfWorkManager] as const`
 * and their own `@Transient(...)`.
 */
export abstract class UserLookupService<TUser extends IUser, TUserRepository extends IUserRepository<TUser>> implements IUserLookupService<TUser> {
  static readonly inject: readonly ServiceKey[] = [IUnitOfWorkManager];
  lazyServiceProvider!: IAbpLazyServiceProvider;
  protected skipExternalLookupIfLocalUserExists = true;
  private externalProvider: IExternalUserLookupServiceProvider | undefined | null = null;

  protected constructor(
    protected readonly userRepository: TUserRepository,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
  ) {}

  get externalUserLookupServiceProvider(): IExternalUserLookupServiceProvider | undefined {
    if (this.externalProvider === null) this.externalProvider = this.lazyServiceProvider.lazyGetService(IExternalUserLookupServiceProvider);
    return this.externalProvider;
  }
  set externalUserLookupServiceProvider(value: IExternalUserLookupServiceProvider | undefined) {
    this.externalProvider = value;
  }

  protected get logger(): ILogger {
    return this.lazyServiceProvider.lazyGetServiceFrom(ILoggerFactory, (provider) => provider.get(ILoggerFactory)?.createLogger(this.constructor.name) ?? NullLogger.instance);
  }

  async findById(id: Guid, signal?: AbortSignal): Promise<TUser | undefined> {
    const localUser = await this.userRepository.find(id, true, signal);
    return this.synchronize(localUser, (provider) => provider.findById(id, signal), signal);
  }

  async findByUserName(userName: string, signal?: AbortSignal): Promise<TUser | undefined> {
    const localUser = await this.userRepository.findByUserName(userName, signal);
    return this.synchronize(localUser, (provider) => provider.findByUserName(userName, signal), signal);
  }

  async search(sorting?: string, filter?: string, maxResultCount = Number.MAX_SAFE_INTEGER, skipCount = 0, signal?: AbortSignal): Promise<IUserData[]> {
    const externalProvider = this.externalUserLookupServiceProvider;
    if (externalProvider) return externalProvider.search(sorting, filter, maxResultCount, skipCount, signal);
    return (await this.userRepository.search(sorting, maxResultCount, skipCount, filter, signal)).map(toAbpUserData);
  }

  async getCount(filter?: string, signal?: AbortSignal): Promise<number> {
    const externalProvider = this.externalUserLookupServiceProvider;
    if (externalProvider) return externalProvider.getCount(filter, signal);
    return this.userRepository.getCount(filter, signal);
  }

  protected abstract createUser(externalUser: IUserData): TUser;

  /** The shared body of `FindByIdAsync`/`FindByUserNameAsync`: reconciles the local user with the external one. */
  private async synchronize(localUser: TUser | undefined, lookup: (provider: IExternalUserLookupServiceProvider) => Promise<IUserData | undefined>, signal: AbortSignal | undefined): Promise<TUser | undefined> {
    const externalProvider = this.externalUserLookupServiceProvider;
    if (!externalProvider) return localUser;
    if (this.skipExternalLookupIfLocalUserExists && localUser) return localUser;

    let externalUser: IUserData | undefined;
    try {
      externalUser = await lookup(externalProvider);
      if (!externalUser) {
        if (localUser) await this.withNewUow(() => this.userRepository.delete(localUser, false, signal));
        return undefined;
      }
    } catch (e) {
      this.logger.logException(e);
      return localUser;
    }

    const found = externalUser;
    if (!localUser) {
      await this.withNewUow(() => this.userRepository.insert(this.createUser(found), false, signal));
      return this.userRepository.find(found.id, true, signal);
    }

    if (isUpdateUserData(localUser) && localUser.update(found)) {
      await this.withNewUow(() => this.userRepository.update(localUser, false, signal));
      return this.userRepository.find(found.id, true, signal);
    }
    return localUser;
  }

  private async withNewUow(fn: () => Promise<unknown>): Promise<void> {
    const uow = this.unitOfWorkManager.begin(undefined, true);
    try {
      await fn();
      await uow.complete();
    } finally {
      await uow.dispose();
    }
  }
}

/* Port of `UserLookupServiceExtensions`. */

export async function getUserById<TUser extends IUser>(userLookupService: IUserLookupService<TUser>, userType: AbstractClass<TUser>, id: Guid, signal?: AbortSignal): Promise<TUser> {
  const user = await userLookupService.findById(id, signal);
  if (!user) throw new EntityNotFoundException(userType, id);
  return user;
}

export async function getUserByUserName<TUser extends IUser>(userLookupService: IUserLookupService<TUser>, userType: AbstractClass<TUser>, userName: string, signal?: AbortSignal): Promise<TUser> {
  const user = await userLookupService.findByUserName(userName, signal);
  if (!user) throw new EntityNotFoundException(userType, userName);
  return user;
}
