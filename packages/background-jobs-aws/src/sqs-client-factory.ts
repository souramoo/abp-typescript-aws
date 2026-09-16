import { SQSClient } from "@aws-sdk/client-sqs";
import { Dependency, Singleton, createToken } from "@abp/core";

/** Creates (lazily) and caches the `SQSClient` of the process; credentials come from the default provider chain. */
export interface ISqsClientFactory {
  getClient(): SQSClient;
}
export const ISqsClientFactory = createToken<ISqsClientFactory>("ISqsClientFactory");

@Dependency({ tryRegister: true })
@Singleton(ISqsClientFactory)
export class DefaultSqsClientFactory implements ISqsClientFactory {
  private client: SQSClient | undefined;

  getClient(): SQSClient {
    const endpoint = process.env["AWS_ENDPOINT_URL_SQS"] ?? process.env["AWS_ENDPOINT_URL"];
    this.client ??= new SQSClient(endpoint ? { endpoint } : {});
    return this.client;
  }
}
