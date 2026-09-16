import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Physical names of the three global secondary indexes of the single table (the attribute names stay `gsiNpk`/`gsiNsk`). */
export interface DynamoDbIndexNames {
  gsi1: string;
  gsi2: string;
  gsi3: string;
}

export type DynamoDbIndexKey = keyof DynamoDbIndexNames;

/** Port of `AbpMongoDbOptions` for the single-table DynamoDB provider. */
export class AbpDynamoDbOptions {
  /**
   * Fallback table name. The table of a db context is its "connection string": `ConnectionStrings:<ConnectionStringName>`
   * resolved through `IConnectionStringResolver` (falling back to `ConnectionStrings:Default`), then this value.
   */
  tableName: string | undefined = undefined;
  /** Prefix of every partition key (lets several applications share one table). Default: empty. */
  keyPrefix = "";
  indexNames: DynamoDbIndexNames = { gsi1: "gsi1", gsi2: "gsi2", gsi3: "gsi3" };
  /** Attribute consumed by the table's TTL setting. Default: `ttl`. */
  ttlAttribute = "ttl";
  /** Strongly consistent `GetItem` for `get`/`find` by id (index queries are always eventually consistent). Default: false. */
  consistentRead = false;
  /** Items per `BatchWriteItem` (at most 25) and concurrent conditional writes per flush. Default: 25. */
  batchSize = 25;
  /**
   * A DynamoDB transaction can contain at most 100 items. When a transactional unit of work exceeds that, the writes are
   * flushed as non-transactional batches with a warning; with `strictTransactions` the unit of work fails instead.
   */
  strictTransactions = false;
  /** Region of the clients created by `DefaultDynamoDbClientFactory`; defaults to `AWS_REGION`/`AWS_DEFAULT_REGION`. */
  region: string | undefined = undefined;
  /** Endpoint override (DynamoDB Local); defaults to `AWS_ENDPOINT_URL_DYNAMODB`/`AWS_ENDPOINT_URL`. */
  endpoint: string | undefined = undefined;
  /** Replaces the document client created by `DefaultDynamoDbClientFactory` (tests, custom middleware). */
  createDocumentClient: (() => DynamoDBDocumentClient) | undefined = undefined;
}
