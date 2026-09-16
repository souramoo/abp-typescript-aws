import { Singleton, createToken, type Class } from "@abp/core";

/** Port of `EventOrderGenerator`: process-wide monotonically increasing order for UoW events. */
let lastOrder = 0;
export const EventOrderGenerator = {
  getNext(): number {
    return ++lastOrder;
  },
};

/** Event identity: the event class, or an event name for events without a class. */
export type UnitOfWorkEventType = Class | string;

/** Port of `UnitOfWorkEventRecord`. */
export class UnitOfWorkEventRecord {
  private order: number;
  readonly properties = new Map<string, unknown>();

  constructor(
    readonly eventType: UnitOfWorkEventType,
    readonly eventData: unknown,
    eventOrder: number,
    readonly useOutbox = true,
  ) {
    this.order = eventOrder;
  }

  get eventOrder(): number {
    return this.order;
  }

  setOrder(order: number): void {
    this.order = order;
  }
}

/** Port of `IUnitOfWorkEventPublisher`: implemented by the event bus package. */
export interface IUnitOfWorkEventPublisher {
  publishLocalEvents(localEvents: readonly UnitOfWorkEventRecord[]): Promise<void>;
  publishDistributedEvents(distributedEvents: readonly UnitOfWorkEventRecord[]): Promise<void>;
}
export const IUnitOfWorkEventPublisher = createToken<IUnitOfWorkEventPublisher>("IUnitOfWorkEventPublisher");

/** Port of `NullUnitOfWorkEventPublisher`. */
@Singleton(IUnitOfWorkEventPublisher)
export class NullUnitOfWorkEventPublisher implements IUnitOfWorkEventPublisher {
  async publishLocalEvents(): Promise<void> {}
  async publishDistributedEvents(): Promise<void> {}
}
