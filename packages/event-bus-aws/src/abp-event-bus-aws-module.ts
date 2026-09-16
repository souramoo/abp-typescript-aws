import { AbpModule, DependsOn, IConfiguration, type ServiceConfigurationContext } from "@abp/core";
import { AbpEventBusModule } from "@abp/event-bus";
import { AbpAwsEventBusOptions } from "./abp-aws-event-bus-options.js";
import "./sns-client-factory.js";
import "./aws-distributed-event-bus.js";

/** Port of `AbpEventBusRabbitMqModule`/`AbpEventBusAzureModule`: registers `AwsDistributedEventBus` and binds `EventBus:Aws:*`. */
@DependsOn(AbpEventBusModule)
export class AbpEventBusAwsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpAwsEventBusOptions, (options) => {
      options.topicArn ??= configuration?.get("EventBus:Aws:TopicArn");
      options.queueUrl ??= configuration?.get("EventBus:Aws:QueueUrl");
    });
  }
}
