import { createHash } from "node:crypto";
import { AbpException, ILoggerFactory, createToken, keyedToken, optionsToken, type Class, type ILogger, type IOptions, type ServiceToken } from "@abp/core";
import { IConnectionStringResolver, getConnectionStringName, resolveConnectionStringFor } from "@abp/data";
import { ICurrentTenant, IgnoreMultiTenancy } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager, type IUnitOfWork } from "@abp/uow";
import { AbpDynamoDbOptions } from "./abp-dynamodb-options.js";
import type { AbpDynamoDbContext } from "./abp-dynamodb-context.js";
import { IDynamoDbClientFactory } from "./dynamodb-client-factory.js";
import { DynamoDbDatabase, DynamoDbDatabaseApi, DynamoDbTransactionApi } from "./dynamodb-database.js";
import { DynamoDbKeyBuilder } from "./dynamodb-keys.js";

/** Port of `IMongoDbContextProvider<TMongoDbContext>`. */
export interface IDynamoDbContextProvider<TDbContext extends AbpDynamoDbContext = AbpDynamoDbContext> {
  getDbContext(signal?: AbortSignal): Promise<TDbContext>;
}
export const IDynamoDbContextProvider = createToken<IDynamoDbContextProvider>("IDynamoDbContextProvider");

const dbContextTypesByToken = new Map<ServiceToken, Class<AbpDynamoDbContext>>();

/** `IDynamoDbContextProvider<TDbContext>`: resolved lazily by `AbpDynamoDbModule` for any registered context. */
export function dynamoDbContextProviderToken<TDbContext extends AbpDynamoDbContext>(dbContextType: Class<TDbContext>): ServiceToken<IDynamoDbContextProvider<TDbContext>> {
  const token = keyedToken<IDynamoDbContextProvider<TDbContext>>(IDynamoDbContextProvider, dbContextType);
  dbContextTypesByToken.set(token, dbContextType);
  return token;
}

export function dbContextTypeOfProviderToken(key: unknown): Class<AbpDynamoDbContext> | undefined {
  return typeof key === "symbol" ? dbContextTypesByToken.get(key as ServiceToken) : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Port of `UnitOfWorkMongoDbContextProvider<TMongoDbContext>`. Like ABP, a context can only be created inside a unit
 * of work (there is no "write immediately without a unit of work" mode): the context is registered as the unit of
 * work's database API and, for transactional units of work, shares one transaction API per table.
 */
export class UnitOfWorkDynamoDbContextProvider<TDbContext extends AbpDynamoDbContext> implements IDynamoDbContextProvider<TDbContext> {
  static readonly inject = [IUnitOfWorkManager, IConnectionStringResolver, ICurrentTenant, IDynamoDbClientFactory, optionsToken(AbpDynamoDbOptions), ILoggerFactory] as const;
  protected readonly options: AbpDynamoDbOptions;
  protected readonly logger: ILogger;

  constructor(
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    protected readonly connectionStringResolver: IConnectionStringResolver,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly clientFactory: IDynamoDbClientFactory,
    options: IOptions<AbpDynamoDbOptions>,
    loggerFactory: ILoggerFactory,
    readonly dbContextType: Class<TDbContext>,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(UnitOfWorkDynamoDbContextProvider.name);
  }

  async getDbContext(_signal?: AbortSignal): Promise<TDbContext> {
    const unitOfWork = this.unitOfWorkManager.current;
    if (!unitOfWork) throw new AbpException(`A ${this.dbContextType.name} instance can only be created inside a unit of work!`);

    const tableName = await this.resolveTableName();
    const databaseApi = await unitOfWork.getOrAddDatabaseApi(this.getDatabaseApiKey(tableName), () => this.createDatabaseApi(unitOfWork, tableName));
    return databaseApi.dbContext as TDbContext;
  }

  protected async createDatabaseApi(unitOfWork: IUnitOfWork, tableName: string): Promise<DynamoDbDatabaseApi> {
    const dbContext = unitOfWork.serviceProvider.getRequired(this.dbContextType);
    const documentClient = this.clientFactory.getDocumentClient();
    const database = new DynamoDbDatabase(tableName, documentClient, this.options, new DynamoDbKeyBuilder(this.options), this.logger);
    if (unitOfWork.options.isTransactional) {
      database.transaction = await unitOfWork.getOrAddTransactionApi(this.getTransactionApiKey(tableName), () => new DynamoDbTransactionApi(tableName, documentClient, this.options, this.logger));
    }
    dbContext.initializeDatabase(database);
    return new DynamoDbDatabaseApi(dbContext);
  }

  /** The table is the "connection string" of the context; `@IgnoreMultiTenancy()` contexts always resolve as the host. */
  protected async resolveTableName(): Promise<string> {
    const resolve = () => resolveConnectionStringFor(this.connectionStringResolver, this.dbContextType);
    const connectionString = IgnoreMultiTenancy.has(this.dbContextType) ? await this.currentTenant.run(undefined, undefined, resolve) : await resolve();
    const tableName = connectionString ?? this.options.tableName;
    if (!tableName) {
      throw new AbpException(`No DynamoDB table is configured for ${this.dbContextType.name}. Set ConnectionStrings:${getConnectionStringName(this.dbContextType)} (or ConnectionStrings:Default) to the table name, or AbpDynamoDbOptions.tableName.`);
    }
    return tableName;
  }

  protected getDatabaseApiKey(tableName: string): string {
    return `${this.dbContextType.name}_${sha256(tableName)}`;
  }

  protected getTransactionApiKey(tableName: string): string {
    return `DynamoDb_${sha256(tableName)}`;
  }
}
