import { AbpModule, DependsOn, type ApplicationInitializationContext, type ApplicationShutdownContext, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { AbpGuidsModule } from "@abp/guids";
import { AbpJsonModule } from "@abp/json";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpUnitOfWorkModule } from "@abp/uow";
import { AbpDistributedEventBusOptions } from "./distributed/distributed-event-bus.js";
import { InboxProcessManager } from "./distributed/inbox-processor.js";
import { OutboxSenderManager } from "./distributed/outbox-sender.js";
import { DistributedEventHandler, LocalEventHandler, type IEventHandler } from "./event-handler.js";
import { AbpLocalEventBusOptions } from "./local/local-event-bus.js";
import "./correlation-id.js";
import "./distributed/local-distributed-event-bus.js";
import "./unit-of-work-event-publisher.js";

/** Port of `AbpEventBusAbstractionsModule` (its .NET dependency on `AbpObjectExtendingModule` is not needed here). */
export class AbpEventBusAbstractionsModule extends AbpModule {}

/**
 * Port of `AbpEventBusModule`. `AbpBackgroundWorkersModule`/`AbpDistributedLockingAbstractionsModule` are not
 * dependencies: the outbox/inbox managers are started here and driven by a scheduler through `runOnce()`.
 */
@DependsOn(AbpEventBusAbstractionsModule, AbpUnitOfWorkModule, AbpMultiTenancyModule, AbpJsonModule, AbpGuidsModule)
export class AbpEventBusModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    addEventHandlers(context.services);
  }

  override async onApplicationInitialization(context: ApplicationInitializationContext): Promise<void> {
    await context.serviceProvider.getRequired(OutboxSenderManager).start();
    await context.serviceProvider.getRequired(InboxProcessManager).start();
  }

  override async onApplicationShutdown(context: ApplicationShutdownContext): Promise<void> {
    await context.serviceProvider.getRequired(OutboxSenderManager).stop();
    await context.serviceProvider.getRequired(InboxProcessManager).stop();
  }
}

/** Port of `AbpEventBusModule.AddEventHandlers`: every registered class declaring handled events is auto-subscribed. */
function addEventHandlers(services: ServiceCollection): void {
  const localHandlers: Class<IEventHandler>[] = [];
  const distributedHandlers: Class<IEventHandler>[] = [];

  services.onRegistered((context) => {
    if (LocalEventHandler.has(context.implementationType)) localHandlers.push(context.implementationType as Class<IEventHandler>);
    if (DistributedEventHandler.has(context.implementationType)) distributedHandlers.push(context.implementationType as Class<IEventHandler>);
  });

  services.options.configure(AbpLocalEventBusOptions, (options) => {
    options.handlers.addRange(localHandlers);
  });
  services.options.configure(AbpDistributedEventBusOptions, (options) => {
    options.handlers.addRange(distributedHandlers);
  });
}
