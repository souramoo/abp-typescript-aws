import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Options of the DynamoDB cache store. */
export class AbpDynamoDbCacheOptions {
  /** Table name; defaults to `ConnectionStrings:Default` of the configuration, then `ABP_DYNAMODB_TABLE`. */
  tableName: string | undefined;
  /** Overrides the document client of `IDynamoDbClientFactory` (tests, custom endpoints). */
  createDocumentClient: (() => DynamoDBDocumentClient) | undefined;
  /** Partition key prefix of cache items. Default: `cache#`. */
  keyPrefix = "cache#";
  /** Sort key of cache items. Default: `cache`. */
  sortKey = "cache";
}
