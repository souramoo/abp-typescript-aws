import { createHash } from "node:crypto";
import { AbpException, createToken, keyedToken, type Class, type ServiceToken } from "@abp/core";
import { IConnectionStringResolver, resolveConnectionStringFor } from "@abp/data";
import { ICurrentTenant, IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager, type IDatabaseApi } from "@abp/uow";
import { MemoryDatabaseManager, type IMemoryDatabase } from "./memory-database.js";
import type { MemoryDbContext } from "./memory-db-context.js";

/** Port of `IMemoryDatabaseProvider<TMemoryDbContext>`. */
export interface IMemoryDatabaseProvider<TDbContext extends MemoryDbContext = MemoryDbContext> {
  getDbContext(): Promise<TDbContext>;
  getDatabase(): Promise<IMemoryDatabase>;
}
export const IMemoryDatabaseProvider = createToken<IMemoryDatabaseProvider>("IMemoryDatabaseProvider");

const dbContextTypesByToken = new Map<ServiceToken, Class<MemoryDbContext>>();

/** `IMemoryDatabaseProvider<TDbContext>`: resolved lazily by `AbpMemoryDbModule` for any registered context. */
export function memoryDatabaseProviderToken<TDbContext extends MemoryDbContext>(dbContextType: Class<TDbContext>): ServiceToken<IMemoryDatabaseProvider<TDbContext>> {
  const token = keyedToken<IMemoryDatabaseProvider<TDbContext>>(IMemoryDatabaseProvider, dbContextType);
  dbContextTypesByToken.set(token, dbContextType);
  return token;
}

export function dbContextTypeOfProviderToken(key: unknown): Class<MemoryDbContext> | undefined {
  return typeof key === "symbol" ? dbContextTypesByToken.get(key as ServiceToken) : undefined;
}

/** Port of `MemoryDbDatabaseApi`: the unit-of-work handle of a memory database. */
export class MemoryDbDatabaseApi implements IDatabaseApi {
  constructor(readonly database: IMemoryDatabase) {}
}

/**
 * Port of `UnitOfWorkMemoryDatabaseProvider<TMemoryDbContext>`: the database of the context's connection string,
 * registered as a database API in the current unit of work (there must be one).
 */
export class UnitOfWorkMemoryDatabaseProvider<TDbContext extends MemoryDbContext> implements IMemoryDatabaseProvider<TDbContext> {
  constructor(
    private readonly unitOfWorkManager: IUnitOfWorkManager,
    private readonly connectionStringResolver: IConnectionStringResolver,
    readonly dbContext: TDbContext,
    private readonly memoryDatabaseManager: MemoryDatabaseManager,
    private readonly currentTenant: ICurrentTenant,
    private readonly dbContextType: Class<TDbContext>,
  ) {}

  static readonly inject = [IUnitOfWorkManager, IConnectionStringResolver, MemoryDatabaseManager, ICurrentTenant] as const;

  async getDbContext(): Promise<TDbContext> {
    return this.dbContext;
  }

  async getDatabase(): Promise<IMemoryDatabase> {
    const unitOfWork = this.unitOfWorkManager.current;
    if (!unitOfWork) throw new AbpException("A IMemoryDatabase instance can only be created inside a unit of work!");

    const connectionString = await this.resolveConnectionString();
    const dbContextKey = this.getDatabaseApiKey(connectionString);
    const databaseApi = await unitOfWork.getOrAddDatabaseApi(dbContextKey, () => new MemoryDbDatabaseApi(this.memoryDatabaseManager.get(connectionString ?? "")));
    return (databaseApi as MemoryDbDatabaseApi).database;
  }

  protected getDatabaseApiKey(connectionString: string | undefined): string {
    return `${this.dbContextType.name}_${createHash("sha256").update(connectionString ?? "").digest("hex")}`;
  }

  /** Multi-tenancy unaware contexts (`@IgnoreMultiTenancy()`) always use the host connection string. */
  private resolveConnectionString(): Promise<string | undefined> {
    if (IgnoreMultiTenancy.has(this.dbContextType)) return this.currentTenant.run(undefined, undefined, () => resolveConnectionStringFor(this.connectionStringResolver, this.dbContextType));
    return resolveConnectionStringFor(this.connectionStringResolver, this.dbContextType);
  }
}
