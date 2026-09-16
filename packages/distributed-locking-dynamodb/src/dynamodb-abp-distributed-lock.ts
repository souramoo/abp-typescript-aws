import { DeleteCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AbpException, Check, Dependency, Guid, ILoggerFactory, Singleton, delay, optionsToken, throwIfAborted, type ILogger, type IOptions } from "@abp/core";
import { IAbpDistributedLock, IDistributedLockKeyNormalizer, type IAbpDistributedLockHandle } from "@abp/distributed-locking";
import { AbpDynamoDbDistributedLockOptions } from "./abp-dynamodb-distributed-lock-options.js";
import { IDynamoDbClientFactory } from "./dynamodb-client-factory.js";

/** The attributes of a lock item in the single table. */
export interface DynamoDbLockItem {
  pk: string;
  sk: string;
  owner: string;
  /** Epoch milliseconds after which the lease can be taken over. */
  expiresAt: number;
  /** Epoch seconds consumed by the table's TTL (safety net for abandoned leases). */
  ttl: number;
}

function isConditionalCheckFailed(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "ConditionalCheckFailedException";
}

/** Handle of an acquired lock: renews the lease periodically and releases it when disposed (only if still owned). */
export class DynamoDbAbpDistributedLockHandle implements IAbpDistributedLockHandle {
  private timer: NodeJS.Timeout | undefined;
  private released = false;

  constructor(
    private readonly lock: DynamoDbAbpDistributedLock,
    readonly key: Pick<DynamoDbLockItem, "pk" | "sk">,
    readonly owner: string,
    renewIntervalMs: number,
  ) {
    this.timer = setInterval(() => void this.renew(), renewIntervalMs);
    this.timer.unref();
  }

  private async renew(): Promise<void> {
    if (this.released) return;
    try {
      await this.lock.renew(this.key, this.owner);
    } catch (e) {
      this.lock.logger.warn(`Could not renew the distributed lock '${this.key.pk}'.`, undefined, e);
    }
  }

  async dispose(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.lock.release(this.key, this.owner);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

/**
 * `IAbpDistributedLock` on DynamoDB conditional writes (replaces `LocalAbpDistributedLock`): a lock is an item
 * `pk = lock#<normalizedName>` created only when absent or expired; the lease is renewed while held, like Medallion's.
 */
@Dependency({ replaceServices: true })
@Singleton(IAbpDistributedLock)
export class DynamoDbAbpDistributedLock implements IAbpDistributedLock {
  static readonly inject = [IDistributedLockKeyNormalizer, optionsToken(AbpDynamoDbDistributedLockOptions), IDynamoDbClientFactory, ILoggerFactory] as const;
  protected readonly options: AbpDynamoDbDistributedLockOptions;
  readonly logger: ILogger;
  private client: DynamoDBDocumentClient | undefined;

  constructor(
    protected readonly distributedLockKeyNormalizer: IDistributedLockKeyNormalizer,
    options: IOptions<AbpDynamoDbDistributedLockOptions>,
    protected readonly clientFactory: IDynamoDbClientFactory,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(DynamoDbAbpDistributedLock.name);
  }

  async tryAcquire(name: string, timeoutMs = 0, signal?: AbortSignal): Promise<IAbpDistributedLockHandle | undefined> {
    Check.notNullOrWhiteSpace(name, "name");
    const key = this.toKey(this.distributedLockKeyNormalizer.normalizeKey(name));
    const owner = Guid.newGuid();
    const deadline = Date.now() + Math.max(0, timeoutMs);

    for (;;) {
      throwIfAborted(signal);
      if (await this.tryPut(key, owner, signal)) {
        return new DynamoDbAbpDistributedLockHandle(this, key, owner, this.options.renewIntervalMs ?? Math.max(1, Math.floor(this.options.leaseDurationMs / 3)));
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return undefined;
      await delay(Math.min(this.options.pollIntervalMs, remaining), signal);
    }
  }

  /** @internal Extends the lease if `owner` still holds the lock. */
  async renew(key: Pick<DynamoDbLockItem, "pk" | "sk">, owner: string): Promise<void> {
    const expiresAt = Date.now() + this.options.leaseDurationMs;
    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: "SET #expires = :expires, #ttl = :ttl",
        ConditionExpression: "#owner = :owner",
        ExpressionAttributeNames: { "#expires": "expiresAt", "#ttl": "ttl", "#owner": "owner" },
        ExpressionAttributeValues: { ":expires": expiresAt, ":ttl": this.toTtl(expiresAt), ":owner": owner },
      }),
    );
  }

  /** @internal Deletes the item only if `owner` still holds the lock (a taken-over lease is left alone). */
  async release(key: Pick<DynamoDbLockItem, "pk" | "sk">, owner: string): Promise<void> {
    try {
      await this.documentClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: key,
          ConditionExpression: "#owner = :owner",
          ExpressionAttributeNames: { "#owner": "owner" },
          ExpressionAttributeValues: { ":owner": owner },
        }),
      );
    } catch (e) {
      if (!isConditionalCheckFailed(e)) throw e;
    }
  }

  protected async tryPut(key: Pick<DynamoDbLockItem, "pk" | "sk">, owner: string, signal: AbortSignal | undefined): Promise<boolean> {
    const now = Date.now();
    const expiresAt = now + this.options.leaseDurationMs;
    const item: DynamoDbLockItem = { ...key, owner, expiresAt, ttl: this.toTtl(expiresAt) };
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk) OR #expires < :now",
          ExpressionAttributeNames: { "#expires": "expiresAt" },
          ExpressionAttributeValues: { ":now": now },
        }),
        { abortSignal: signal },
      );
      return true;
    } catch (e) {
      if (isConditionalCheckFailed(e)) return false;
      throw e;
    }
  }

  protected toKey(normalizedName: string): Pick<DynamoDbLockItem, "pk" | "sk"> {
    return { pk: `${this.options.keyPrefix}${normalizedName}`, sk: this.options.sortKey };
  }

  /** The TTL leaves a full extra lease so a slow renewal never races the table's deletion. */
  protected toTtl(expiresAt: number): number {
    return Math.ceil((expiresAt + this.options.leaseDurationMs) / 1000);
  }

  protected get tableName(): string {
    const name = this.options.tableName;
    if (!name) throw new AbpException("AbpDynamoDbDistributedLockOptions.tableName is not configured (set ConnectionStrings:Default or ABP_DYNAMODB_TABLE).");
    return name;
  }

  protected get documentClient(): DynamoDBDocumentClient {
    this.client ??= this.options.createDocumentClient?.() ?? this.clientFactory.getDocumentClient();
    return this.client;
  }
}
