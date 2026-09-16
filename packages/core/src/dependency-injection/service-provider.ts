import { type ServiceDescriptor, ServiceLifetime, implementationTypeOf } from "./service-descriptor.js";
import { type Class, type ServiceKey, type ServiceType, createToken, describeKey } from "./service-token.js";
import { injectKeysOf } from "./injectable.js";
import { createInterceptedProxy } from "./interception.js";
import { AbpException } from "../exception-handling/exceptions.js";
import type { ServiceCollection } from "./service-collection.js";
import { OptionsManager, optionsClassOf, optionsToken, type OptionsClass } from "../options/options-registry.js";

/** Port of `IServiceProvider` + `IServiceScope`. */
export interface IServiceProvider {
  get<K extends ServiceKey>(key: K): ServiceType<K> | undefined;
  getRequired<K extends ServiceKey>(key: K): ServiceType<K>;
  /** `IEnumerable<T>` resolution: every registration of the key, in registration order. */
  getAll<K extends ServiceKey>(key: K): ServiceType<K>[];
  /** `IOptions<T>.Value` shortcut. */
  getOptions<T extends object>(optionsClass: OptionsClass<T>): T;
  createScope(): IServiceScope;
  readonly root: IServiceProvider;
}

export interface IServiceScope extends AsyncDisposable {
  readonly serviceProvider: IServiceProvider;
  dispose(): Promise<void>;
}

/** Token to resolve the current (scoped or root) provider itself. */
export const IServiceProviderToken = createToken<IServiceProvider>("IServiceProvider");
export const IRootServiceProvider = createToken<IServiceProvider>("IRootServiceProvider");

export interface IServiceProviderAccessor {
  readonly serviceProvider: IServiceProvider;
}

export interface Disposable_ {
  dispose?(): void | Promise<void>;
}

/** Port of `IAbpLazyServiceProvider`: resolve-on-demand with per-instance caching (property injected). */
export interface IAbpLazyServiceProvider {
  lazyGetRequiredService<K extends ServiceKey>(key: K): ServiceType<K>;
  lazyGetService<K extends ServiceKey>(key: K): ServiceType<K> | undefined;
  lazyGetServiceOr<K extends ServiceKey>(key: K, defaultValue: ServiceType<K>): ServiceType<K>;
  lazyGetServiceFrom<T>(key: ServiceKey, factory: (provider: IServiceProvider) => T): T;
  readonly serviceProvider: IServiceProvider;
}

export const IAbpLazyServiceProvider = createToken<IAbpLazyServiceProvider>("IAbpLazyServiceProvider");

export class AbpLazyServiceProvider implements IAbpLazyServiceProvider {
  private readonly cache = new Map<ServiceKey, unknown>();
  constructor(readonly serviceProvider: IServiceProvider) {}

  lazyGetRequiredService<K extends ServiceKey>(key: K): ServiceType<K> {
    if (!this.cache.has(key)) this.cache.set(key, this.serviceProvider.getRequired(key));
    return this.cache.get(key) as ServiceType<K>;
  }
  lazyGetService<K extends ServiceKey>(key: K): ServiceType<K> | undefined {
    if (!this.cache.has(key)) this.cache.set(key, this.serviceProvider.get(key));
    return this.cache.get(key) as ServiceType<K> | undefined;
  }
  lazyGetServiceOr<K extends ServiceKey>(key: K, defaultValue: ServiceType<K>): ServiceType<K> {
    return this.lazyGetService(key) ?? defaultValue;
  }
  lazyGetServiceFrom<T>(key: ServiceKey, factory: (provider: IServiceProvider) => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory(this.serviceProvider));
    return this.cache.get(key) as T;
  }
}

/** Marker: classes with this property get a lazy provider injected after construction. */
export interface IHasLazyServiceProvider {
  lazyServiceProvider: IAbpLazyServiceProvider;
}

function hasLazyServiceProviderSlot(instance: object): instance is IHasLazyServiceProvider {
  return "lazyServiceProvider" in instance;
}

interface ResolutionContext {
  readonly stack: ServiceKey[];
}

export class ServiceProvider implements IServiceProvider {
  private readonly singletons = new Map<ServiceDescriptor, unknown>();
  private readonly optionsCache = new Map<OptionsClass, OptionsManager<object>>();
  private readonly scoped = new Map<ServiceDescriptor, unknown>();
  private readonly disposables: object[] = [];
  private disposed = false;
  readonly root: ServiceProvider;
  private readonly isRoot: boolean;

  constructor(
    private readonly services: ServiceCollection,
    root?: ServiceProvider,
  ) {
    this.root = root ?? this;
    this.isRoot = root === undefined;
  }

  get<K extends ServiceKey>(key: K): ServiceType<K> | undefined {
    return this.resolve(key, { stack: [] }) as ServiceType<K> | undefined;
  }

  getRequired<K extends ServiceKey>(key: K): ServiceType<K> {
    const value = this.get(key);
    if (value === undefined) throw new AbpException(`No service for type '${describeKey(key)}' has been registered.`);
    return value;
  }

  getAll<K extends ServiceKey>(key: K): ServiceType<K>[] {
    return this.services.getDescriptors(key).map((d) => this.resolveDescriptor(d, { stack: [] }) as ServiceType<K>);
  }

  getOptions<T extends object>(optionsClass: OptionsClass<T>): T {
    return this.getRequired(optionsToken(optionsClass)).value;
  }

  private getOptionsManager(cls: OptionsClass): OptionsManager<object> {
    let manager = this.optionsCache.get(cls);
    if (!manager) {
      manager = new OptionsManager(this.services.options, cls);
      this.optionsCache.set(cls, manager);
    }
    return manager;
  }

  createScope(): IServiceScope {
    const scoped = new ServiceProvider(this.services, this.root);
    return {
      serviceProvider: scoped,
      dispose: () => scoped.disposeScope(),
      [Symbol.asyncDispose]: () => scoped.disposeScope(),
    };
  }

  async disposeScope(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of this.disposables.reverse()) {
      const d = instance as { dispose?: () => unknown; [Symbol.asyncDispose]?: () => unknown; [Symbol.dispose]?: () => unknown };
      const asyncDispose = d[Symbol.asyncDispose];
      const syncDispose = d[Symbol.dispose];
      if (typeof asyncDispose === "function") await asyncDispose.call(d);
      else if (typeof d.dispose === "function") await d.dispose();
      else if (typeof syncDispose === "function") syncDispose.call(d);
    }
    this.disposables.length = 0;
  }

  private resolve(key: ServiceKey, ctx: ResolutionContext): unknown {
    if (key === IServiceProviderToken) return this;
    if (key === IRootServiceProvider) return this.root;
    if (key === IAbpLazyServiceProvider) return new AbpLazyServiceProvider(this);
    const descriptors = this.services.getDescriptors(key);
    if (descriptors.length === 0) {
      const optionsClass = optionsClassOf(key);
      if (optionsClass) return this.root.getOptionsManager(optionsClass);
    }
    const descriptor = descriptors[descriptors.length - 1];
    if (!descriptor) return undefined;
    return this.resolveDescriptor(descriptor, ctx);
  }

  private resolveDescriptor(descriptor: ServiceDescriptor, ctx: ResolutionContext): unknown {
    switch (descriptor.lifetime) {
      case ServiceLifetime.Singleton:
        return this.root.getOrCreate(this.root.singletons, descriptor, ctx);
      case ServiceLifetime.Scoped:
        if (this.isRoot) {
          // Root provider acts as its own scope (matches .NET's default, non-validating provider).
        }
        return this.getOrCreate(this.scoped, descriptor, ctx);
      case ServiceLifetime.Transient:
        return this.create(descriptor, ctx);
      default: {
        const _exhaustive: never = descriptor.lifetime;
        throw new AbpException(`Unknown lifetime ${String(_exhaustive)}`);
      }
    }
  }

  private getOrCreate(cache: Map<ServiceDescriptor, unknown>, descriptor: ServiceDescriptor, ctx: ResolutionContext): unknown {
    const shared = this.findSharedInstance(cache, descriptor);
    if (shared !== undefined) return shared;
    const instance = this.create(descriptor, ctx);
    cache.set(descriptor, instance);
    return instance;
  }

  /** Conventional registrations expose one implementation under several keys and share the instance. */
  private findSharedInstance(cache: Map<ServiceDescriptor, unknown>, descriptor: ServiceDescriptor): unknown {
    const direct = cache.get(descriptor);
    if (direct !== undefined) return direct;
    const type = implementationTypeOf(descriptor);
    if (!type || descriptor.exposedKeys.length <= 1) return undefined;
    for (const [other, instance] of cache) {
      if (other !== descriptor && other.lifetime === descriptor.lifetime && implementationTypeOf(other) === type && other.exposedKeys === descriptor.exposedKeys) {
        cache.set(descriptor, instance);
        return instance;
      }
    }
    return undefined;
  }

  private create(descriptor: ServiceDescriptor, ctx: ResolutionContext): unknown {
    const impl = descriptor.implementation;
    switch (impl.kind) {
      case "value":
        return impl.value;
      case "factory": {
        const instance = impl.factory(this);
        this.track(instance, descriptor.lifetime);
        return instance;
      }
      case "class":
        return this.instantiate(impl.type, descriptor, ctx);
      default: {
        const _exhaustive: never = impl;
        throw new AbpException(`Unknown implementation ${String(_exhaustive)}`);
      }
    }
  }

  private instantiate(type: Class, descriptor: ServiceDescriptor, ctx: ResolutionContext): object {
    if (ctx.stack.includes(descriptor.key)) {
      throw new AbpException(`Circular dependency detected: ${[...ctx.stack, descriptor.key].map(describeKey).join(" -> ")}`);
    }
    const inner: ResolutionContext = { stack: [...ctx.stack, descriptor.key] };
    const args = injectKeysOf(type).map((k) => {
      const value = this.resolve(k, inner);
      if (value === undefined) {
        throw new AbpException(`Unable to resolve service for type '${describeKey(k)}' while attempting to activate '${type.name}'.`);
      }
      return value;
    });
    const instance = new type(...args);
    if (hasLazyServiceProviderSlot(instance)) instance.lazyServiceProvider = new AbpLazyServiceProvider(this);
    for (const action of this.services.getActivationActions()) action({ instance, implementationType: type, provider: this });
    this.track(instance, descriptor.lifetime);
    return createInterceptedProxy(instance, type, this.services.getInterceptors(type), this);
  }

  private track(instance: unknown, lifetime: ServiceLifetime): void {
    if (instance === null || typeof instance !== "object") return;
    const d = instance as { dispose?: unknown; [Symbol.asyncDispose]?: unknown; [Symbol.dispose]?: unknown };
    if (typeof d.dispose !== "function" && typeof d[Symbol.asyncDispose] !== "function" && typeof d[Symbol.dispose] !== "function") return;
    const owner = lifetime === ServiceLifetime.Singleton ? this.root : this;
    owner.disposables.push(instance);
  }
}
