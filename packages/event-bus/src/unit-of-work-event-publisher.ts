import { Dependency, Transient } from "@abp/core";
import { IUnitOfWorkEventPublisher, type UnitOfWorkEventRecord } from "@abp/uow";
import { IDistributedEventBus } from "./distributed/distributed-event-bus.js";
import { ILocalEventBus } from "./local/local-event-bus.js";

/** Port of `UnitOfWorkEventPublisher`: replaces `NullUnitOfWorkEventPublisher` so a completing unit of work publishes its events. */
@Dependency({ replaceServices: true })
@Transient(IUnitOfWorkEventPublisher)
export class UnitOfWorkEventPublisher implements IUnitOfWorkEventPublisher {
  static readonly inject = [ILocalEventBus, IDistributedEventBus] as const;

  constructor(
    private readonly localEventBus: ILocalEventBus,
    private readonly distributedEventBus: IDistributedEventBus,
  ) {}

  async publishLocalEvents(localEvents: readonly UnitOfWorkEventRecord[]): Promise<void> {
    for (const localEvent of localEvents) {
      await this.localEventBus.publish(localEvent.eventType, localEvent.eventData as object, false);
    }
  }

  async publishDistributedEvents(distributedEvents: readonly UnitOfWorkEventRecord[]): Promise<void> {
    for (const distributedEvent of distributedEvents) {
      await this.distributedEventBus.publish(distributedEvent.eventType, distributedEvent.eventData as object, false, distributedEvent.useOutbox);
    }
  }
}
