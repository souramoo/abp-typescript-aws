import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Singleton, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpDynamoDbOptions } from "./abp-dynamodb-options.js";

/**
 * Creates (lazily) and caches the DynamoDB clients of the process; credentials come from the default provider chain.
 * Canonical copy of the factory duplicated in `@abp/caching-dynamodb` and `@abp/distributed-locking-dynamodb`.
 */
export interface IDynamoDbClientFactory {
  getClient(): DynamoDBClient;
  getDocumentClient(): DynamoDBDocumentClient;
}
export const IDynamoDbClientFactory = createToken<IDynamoDbClientFactory>("IDynamoDbClientFactory");

/** Reads the endpoint override (`AWS_ENDPOINT_URL_DYNAMODB`, e.g. DynamoDB Local) used by the default factory. */
export function dynamoDbEndpointFromEnvironment(): string | undefined {
  return nonEmpty(process.env["AWS_ENDPOINT_URL_DYNAMODB"] ?? process.env["AWS_ENDPOINT_URL"]);
}

export function dynamoDbRegionFromEnvironment(): string | undefined {
  return nonEmpty(process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"]);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** Marshalling used for entity items: `undefined` attributes are dropped and class instances become maps. */
export const dynamoDbMarshallOptions = { removeUndefinedValues: true, convertClassInstanceToMap: true } as const;

@Singleton(IDynamoDbClientFactory)
export class DefaultDynamoDbClientFactory implements IDynamoDbClientFactory {
  static readonly inject = [optionsToken(AbpDynamoDbOptions)] as const;
  private readonly clients = new Map<string, DynamoDBClient>();
  private documentClient: DynamoDBDocumentClient | undefined;
  protected readonly options: AbpDynamoDbOptions;

  constructor(options?: IOptions<AbpDynamoDbOptions>) {
    this.options = options?.value ?? new AbpDynamoDbOptions();
  }

  getClient(): DynamoDBClient {
    const region = this.options.region ?? dynamoDbRegionFromEnvironment();
    const endpoint = this.options.endpoint ?? dynamoDbEndpointFromEnvironment();
    const cacheKey = `${region ?? ""}|${endpoint ?? ""}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new DynamoDBClient({ region, endpoint });
      this.clients.set(cacheKey, client);
    }
    return client;
  }

  getDocumentClient(): DynamoDBDocumentClient {
    this.documentClient ??= this.options.createDocumentClient?.() ?? DynamoDBDocumentClient.from(this.getClient(), { marshallOptions: dynamoDbMarshallOptions });
    return this.documentClient;
  }
}
