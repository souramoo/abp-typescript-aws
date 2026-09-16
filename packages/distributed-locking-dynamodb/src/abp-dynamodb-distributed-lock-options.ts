import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Options of the DynamoDB distributed lock. */
export class AbpDynamoDbDistributedLockOptions {
  /** Table name; defaults to `ConnectionStrings:Default` of the configuration, then `ABP_DYNAMODB_TABLE`. */
  tableName: string | undefined;
  /** How long a lease is held before it expires without renewal. Default: 30 seconds. */
  leaseDurationMs = 30_000;
  /** How often the lease of a held lock is renewed. Default: a third of `leaseDurationMs`. */
  renewIntervalMs: number | undefined;
  /** Wait between acquisition attempts while another owner holds the lock. Default: 250 ms. */
  pollIntervalMs = 250;
  /** Partition key prefix of lock items. Default: `lock#`. */
  keyPrefix = "lock#";
  /** Sort key of lock items. Default: `lock`. */
  sortKey = "lock";
  /** Overrides the document client of `IDynamoDbClientFactory`. */
  createDocumentClient: (() => DynamoDBDocumentClient) | undefined;
}
