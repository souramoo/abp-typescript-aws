import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Dependency, Singleton, createToken } from "@abp/core";

/**
 * Creates (lazily) and caches the DynamoDB clients of the process; credentials come from the default provider chain.
 * Same contract as the factory of `@abp/caching-dynamodb`; both should move to `@abp/dynamodb` once it exists.
 */
export interface IDynamoDbClientFactory {
  getClient(): DynamoDBClient;
  getDocumentClient(): DynamoDBDocumentClient;
}
export const IDynamoDbClientFactory = createToken<IDynamoDbClientFactory>("IDynamoDbClientFactory");

function endpointFromEnvironment(): string | undefined {
  const endpoint = process.env["AWS_ENDPOINT_URL_DYNAMODB"] ?? process.env["AWS_ENDPOINT_URL"];
  return endpoint === undefined || endpoint === "" ? undefined : endpoint;
}

@Dependency({ tryRegister: true })
@Singleton(IDynamoDbClientFactory)
export class DefaultDynamoDbClientFactory implements IDynamoDbClientFactory {
  private client: DynamoDBClient | undefined;
  private documentClient: DynamoDBDocumentClient | undefined;

  getClient(): DynamoDBClient {
    this.client ??= new DynamoDBClient({ endpoint: endpointFromEnvironment() });
    return this.client;
  }

  getDocumentClient(): DynamoDBDocumentClient {
    this.documentClient ??= DynamoDBDocumentClient.from(this.getClient(), { marshallOptions: { removeUndefinedValues: true } });
    return this.documentClient;
  }
}
