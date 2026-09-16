import { CreateTableCommand, DescribeTableCommand, UpdateTimeToLiveCommand, waitUntilTableExists, type CreateTableCommandInput } from "@aws-sdk/client-dynamodb";
import { AbpException, ILoggerFactory, Transient, createToken, optionsToken, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { IConnectionStringResolver } from "@abp/data";
import { AbpDynamoDbOptions } from "./abp-dynamodb-options.js";
import { IDynamoDbClientFactory } from "./dynamodb-client-factory.js";
import { indexAttributeNames } from "./dynamodb-keys.js";

/** Creates the single table for local development (DynamoDB Local); production tables come from the CDK stack. */
export interface IDynamoDbTableManager {
  tableExists(tableName: string, signal?: AbortSignal): Promise<boolean>;
  /** Creates the table (same schema as `infra/lib/abp-app-stack.ts`) when it is missing; returns true when it was created. */
  ensureTableExists(tableName?: string, signal?: AbortSignal): Promise<boolean>;
}
export const IDynamoDbTableManager = createToken<IDynamoDbTableManager>("IDynamoDbTableManager");

/** The `CreateTable` input matching the CDK definition: `pk`/`sk`, `gsi1..gsi3` (all attributes projected), on-demand billing. */
export function createTableInput(tableName: string, options: AbpDynamoDbOptions): CreateTableCommandInput {
  const indexes = (["gsi1", "gsi2", "gsi3"] as const).map((index) => ({ index, ...indexAttributeNames(index) }));
  return {
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      ...indexes.flatMap((i) => [
        { AttributeName: i.pk, AttributeType: "S" as const },
        { AttributeName: i.sk, AttributeType: "S" as const },
      ]),
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: indexes.map((i) => ({
      IndexName: options.indexNames[i.index],
      KeySchema: [
        { AttributeName: i.pk, KeyType: "HASH" },
        { AttributeName: i.sk, KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    })),
  };
}

@Transient(IDynamoDbTableManager)
export class DynamoDbTableManager implements IDynamoDbTableManager {
  static readonly inject = [IDynamoDbClientFactory, optionsToken(AbpDynamoDbOptions), IConnectionStringResolver, ILoggerFactory] as const;
  protected readonly options: AbpDynamoDbOptions;
  protected readonly logger: ILogger;

  constructor(
    protected readonly clientFactory: IDynamoDbClientFactory,
    options: IOptions<AbpDynamoDbOptions>,
    protected readonly connectionStringResolver: IConnectionStringResolver,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(DynamoDbTableManager.name);
  }

  async tableExists(tableName: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.clientFactory.getClient().send(new DescribeTableCommand({ TableName: tableName }), { abortSignal: signal });
      return true;
    } catch (e) {
      if ((e as { name?: unknown }).name === "ResourceNotFoundException") return false;
      throw e;
    }
  }

  async ensureTableExists(tableName?: string, signal?: AbortSignal): Promise<boolean> {
    const name = tableName ?? (await this.connectionStringResolver.resolve()) ?? this.options.tableName;
    if (!name) throw new AbpException("No DynamoDB table name is configured (ConnectionStrings:Default or AbpDynamoDbOptions.tableName).");
    if (await this.tableExists(name, signal)) return false;

    const client = this.clientFactory.getClient();
    this.logger.info(`Creating DynamoDB table ${name}.`);
    await client.send(new CreateTableCommand(createTableInput(name, this.options)), { abortSignal: signal });
    await waitUntilTableExists({ client, maxWaitTime: 60, abortSignal: signal }, { TableName: name });
    try {
      await client.send(new UpdateTimeToLiveCommand({ TableName: name, TimeToLiveSpecification: { AttributeName: this.options.ttlAttribute, Enabled: true } }), { abortSignal: signal });
    } catch (e) {
      this.logger.warn(`Could not enable TTL on ${name}; expiring items will not be removed automatically.`, undefined, e);
    }
    return true;
  }
}

/** `pnpm dev` helper: `await ensureTableExists(app.serviceProvider)` before serving requests against DynamoDB Local. */
export function ensureTableExists(serviceProvider: IServiceProvider, tableName?: string, signal?: AbortSignal): Promise<boolean> {
  return serviceProvider.getRequired(IDynamoDbTableManager).ensureTableExists(tableName, signal);
}
