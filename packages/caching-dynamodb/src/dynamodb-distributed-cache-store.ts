import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AbpException, Dependency, Singleton, optionsToken, type IOptions } from "@abp/core";
import { IDistributedCacheStore, type CacheValue, type DistributedCacheEntryOptions, type ICacheSupportsMultipleItems } from "@abp/caching";
import { AbpDynamoDbCacheOptions } from "./abp-dynamodb-cache-options.js";
import { IDynamoDbClientFactory } from "./dynamodb-client-factory.js";

/** The attributes of a cache item in the single table. */
export interface DynamoDbCacheItem {
  pk: string;
  sk: string;
  value: CacheValue;
  /** Epoch milliseconds. */
  absoluteExpiration?: number;
  /** Milliseconds of inactivity after which the entry expires. */
  slidingExpiration?: number;
  /** Epoch seconds consumed by the table's TTL (lazy deletion: reads treat an elapsed `ttl` as a miss). */
  ttl?: number;
}

type Expirations = Pick<DynamoDbCacheItem, "absoluteExpiration" | "slidingExpiration">;

const BatchGetLimit = 100;
const BatchWriteLimit = 25;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** `IDistributedCache` store on the DynamoDB single table (`pk = cache#<key>`, `sk = cache`). */
@Dependency({ replaceServices: true })
@Singleton(IDistributedCacheStore)
export class DynamoDbDistributedCacheStore implements IDistributedCacheStore, ICacheSupportsMultipleItems {
  static readonly inject = [optionsToken(AbpDynamoDbCacheOptions), IDynamoDbClientFactory] as const;
  protected readonly options: AbpDynamoDbCacheOptions;
  private client: DynamoDBDocumentClient | undefined;

  constructor(
    options: IOptions<AbpDynamoDbCacheOptions>,
    protected readonly clientFactory: IDynamoDbClientFactory,
  ) {
    this.options = options.value;
  }

  async get(key: string, signal?: AbortSignal): Promise<CacheValue | undefined> {
    const item = await this.getItem(key, signal);
    if (!item) return undefined;
    await this.slide(item, signal);
    return item.value;
  }

  async set(key: string, value: CacheValue, options: DistributedCacheEntryOptions, signal?: AbortSignal): Promise<void> {
    await this.documentClient.send(new PutCommand({ TableName: this.tableName, Item: this.toItem(key, value, options, this.now()) }), { abortSignal: signal });
  }

  async refresh(key: string, signal?: AbortSignal): Promise<void> {
    const item = await this.getItem(key, signal, true);
    if (item) await this.slide(item, signal);
  }

  async remove(key: string, signal?: AbortSignal): Promise<void> {
    await this.documentClient.send(new DeleteCommand({ TableName: this.tableName, Key: this.toKey(key) }), { abortSignal: signal });
  }

  async getMany(keys: readonly string[], signal?: AbortSignal): Promise<(CacheValue | undefined)[]> {
    const found = new Map<string, DynamoDbCacheItem>();
    for (const batch of chunk([...new Set(keys)], BatchGetLimit)) {
      const response = await this.documentClient.send(new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: batch.map((k) => this.toKey(k)) } } }), { abortSignal: signal });
      for (const raw of response.Responses?.[this.tableName] ?? []) {
        const item = this.toLiveItem(raw);
        if (item) found.set(item.pk, item);
      }
    }
    for (const item of found.values()) await this.slide(item, signal);
    return keys.map((k) => found.get(this.toPk(k))?.value);
  }

  async setMany(items: readonly { key: string; value: CacheValue }[], options: DistributedCacheEntryOptions, signal?: AbortSignal): Promise<void> {
    const now = this.now();
    for (const batch of chunk(items, BatchWriteLimit)) {
      await this.documentClient.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: batch.map((i) => ({ PutRequest: { Item: this.toItem(i.key, i.value, options, now) } })) } }), { abortSignal: signal });
    }
  }

  async refreshMany(keys: readonly string[], signal?: AbortSignal): Promise<void> {
    for (const key of keys) await this.refresh(key, signal);
  }

  async removeMany(keys: readonly string[], signal?: AbortSignal): Promise<void> {
    for (const batch of chunk([...new Set(keys)], BatchWriteLimit)) {
      await this.documentClient.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: batch.map((k) => ({ DeleteRequest: { Key: this.toKey(k) } })) } }), { abortSignal: signal });
    }
  }

  protected get tableName(): string {
    const name = this.options.tableName;
    if (!name) throw new AbpException("AbpDynamoDbCacheOptions.tableName is not configured (set ConnectionStrings:Default or ABP_DYNAMODB_TABLE).");
    return name;
  }

  protected get documentClient(): DynamoDBDocumentClient {
    this.client ??= this.options.createDocumentClient?.() ?? this.clientFactory.getDocumentClient();
    return this.client;
  }

  protected now(): number {
    return Date.now();
  }

  protected toPk(key: string): string {
    return `${this.options.keyPrefix}${key}`;
  }

  protected toKey(key: string): Pick<DynamoDbCacheItem, "pk" | "sk"> {
    return { pk: this.toPk(key), sk: this.options.sortKey };
  }

  protected toItem(key: string, value: CacheValue, options: DistributedCacheEntryOptions, now: number): DynamoDbCacheItem {
    const absoluteExpiration = options.absoluteExpiration?.getTime() ?? (options.absoluteExpirationRelativeToNow === undefined ? undefined : now + options.absoluteExpirationRelativeToNow);
    const expirations: Expirations = { absoluteExpiration, slidingExpiration: options.slidingExpiration };
    return { ...this.toKey(key), value, absoluteExpiration, slidingExpiration: options.slidingExpiration, ttl: this.toTtl(expirations, now) };
  }

  /** Next expiration in epoch seconds: the earlier of the sliding window end and the absolute expiration. */
  protected toTtl(expirations: Expirations, now: number): number | undefined {
    const sliding = expirations.slidingExpiration === undefined ? undefined : now + expirations.slidingExpiration;
    const next = sliding === undefined ? expirations.absoluteExpiration : expirations.absoluteExpiration === undefined ? sliding : Math.min(sliding, expirations.absoluteExpiration);
    return next === undefined ? undefined : Math.ceil(next / 1000);
  }

  private async getItem(key: string, signal: AbortSignal | undefined, metadataOnly = false): Promise<DynamoDbCacheItem | undefined> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.toKey(key),
        ...(metadataOnly ? { ProjectionExpression: "pk, sk, absoluteExpiration, slidingExpiration, #ttl", ExpressionAttributeNames: { "#ttl": "ttl" } } : {}),
      }),
      { abortSignal: signal },
    );
    return this.toLiveItem(response.Item);
  }

  private toLiveItem(raw: Record<string, unknown> | undefined): DynamoDbCacheItem | undefined {
    if (!raw || typeof raw["pk"] !== "string") return undefined;
    const item = raw as unknown as DynamoDbCacheItem;
    if (item.ttl !== undefined && item.ttl * 1000 <= this.now()) return undefined;
    return item;
  }

  /** Extends the TTL of a sliding entry on access (port of the sliding expiration refresh). */
  private async slide(item: DynamoDbCacheItem, signal: AbortSignal | undefined): Promise<void> {
    if (item.slidingExpiration === undefined) return;
    const ttl = this.toTtl(item, this.now());
    if (ttl === undefined || ttl === item.ttl) return;
    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: item.pk, sk: item.sk },
        UpdateExpression: "SET #ttl = :ttl",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":ttl": ttl },
      }),
      { abortSignal: signal },
    ).catch((e: unknown) => {
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") return;
      throw e;
    });
  }
}
