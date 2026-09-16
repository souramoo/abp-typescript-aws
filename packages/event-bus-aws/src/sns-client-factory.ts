import { SNSClient } from "@aws-sdk/client-sns";
import { Dependency, Singleton, createToken } from "@abp/core";

/** Creates (lazily) and caches the `SNSClient` of the process; credentials come from the default provider chain. */
export interface ISnsClientFactory {
  getClient(): SNSClient;
}
export const ISnsClientFactory = createToken<ISnsClientFactory>("ISnsClientFactory");

@Dependency({ tryRegister: true })
@Singleton(ISnsClientFactory)
export class DefaultSnsClientFactory implements ISnsClientFactory {
  private client: SNSClient | undefined;

  getClient(): SNSClient {
    const endpoint = process.env["AWS_ENDPOINT_URL_SNS"] ?? process.env["AWS_ENDPOINT_URL"];
    this.client ??= new SNSClient(endpoint ? { endpoint } : {});
    return this.client;
  }
}
