import type { Class, IServiceProvider } from "@abp/core";
import { EventHandlerDisposeWrapper, type EventHandlerAction, type EventType, type IEventHandler, type IEventHandlerDisposeWrapper, type IEventHandlerFactory, type ILocalEventHandler } from "./event-handler.js";
import type { IEventBus } from "./event-bus.js";

/** Port of `ActionEventHandler<TEvent>`: adapts a function to `ILocalEventHandler<TEvent>`. */
export class ActionEventHandler<TEvent> implements ILocalEventHandler<TEvent> {
  constructor(readonly action: EventHandlerAction<TEvent>) {}

  async handleEvent(eventData: TEvent): Promise<void> {
    await this.action(eventData);
  }
}

/** Port of `SingleInstanceHandlerFactory`: always returns the same handler instance. */
export class SingleInstanceHandlerFactory implements IEventHandlerFactory {
  constructor(readonly handlerInstance: IEventHandler) {}

  getHandler(): IEventHandlerDisposeWrapper {
    return new EventHandlerDisposeWrapper(this.handlerInstance);
  }

  isInFactories(handlerFactories: readonly IEventHandlerFactory[]): boolean {
    return handlerFactories.some((f) => f instanceof SingleInstanceHandlerFactory && f.handlerInstance === this.handlerInstance);
  }
}

/** Port of `TransientEventHandlerFactory`: creates a new handler (`new THandler()`) per event. */
export class TransientEventHandlerFactory implements IEventHandlerFactory {
  constructor(readonly handlerType: Class<IEventHandler>) {}

  getHandler(): IEventHandlerDisposeWrapper {
    const handler = this.createHandler();
    return new EventHandlerDisposeWrapper(handler, () => disposeIfDisposable(handler));
  }

  isInFactories(handlerFactories: readonly IEventHandlerFactory[]): boolean {
    return handlerFactories.some((f) => f instanceof TransientEventHandlerFactory && f.handlerType === this.handlerType);
  }

  protected createHandler(): IEventHandler {
    return new this.handlerType();
  }
}

/** Port of `IocEventHandlerFactory`: resolves the handler from a new service scope per event. */
export class IocEventHandlerFactory implements IEventHandlerFactory {
  constructor(
    protected readonly serviceProvider: IServiceProvider,
    readonly handlerType: Class<IEventHandler>,
  ) {}

  getHandler(): IEventHandlerDisposeWrapper {
    const scope = this.serviceProvider.createScope();
    try {
      return new EventHandlerDisposeWrapper(scope.serviceProvider.getRequired(this.handlerType), () => scope.dispose());
    } catch (e) {
      void scope.dispose();
      throw e;
    }
  }

  isInFactories(handlerFactories: readonly IEventHandlerFactory[]): boolean {
    return handlerFactories.some((f) => f instanceof IocEventHandlerFactory && f.handlerType === this.handlerType);
  }
}

/** The handler class behind a factory, when known without creating a handler (used for `LocalEventHandlerOrder`). */
export function getHandlerTypeOfFactory(factory: IEventHandlerFactory): Class | undefined {
  if (factory instanceof IocEventHandlerFactory || factory instanceof TransientEventHandlerFactory) return factory.handlerType;
  if (factory instanceof SingleInstanceHandlerFactory) return factory.handlerInstance.constructor as Class;
  return undefined;
}

/** Port of `EventHandlerFactoryUnregistrar` / `DynamicEventHandlerFactoryUnregistrar`. */
export class EventHandlerFactoryUnregistrar implements Disposable {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly eventTypeOrName: EventType | string,
    private readonly factory: IEventHandlerFactory,
  ) {}

  dispose(): void {
    this.eventBus.unsubscribe(this.eventTypeOrName, this.factory);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

function disposeIfDisposable(handler: object): void | Promise<void> {
  const d = handler as { dispose?: () => void | Promise<void>; [Symbol.dispose]?: () => void };
  if (typeof d.dispose === "function") return d.dispose();
  const syncDispose = d[Symbol.dispose];
  if (typeof syncDispose === "function") syncDispose.call(d);
}
