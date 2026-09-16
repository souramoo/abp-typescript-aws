import { type ServiceDescriptor, type ServiceImplementation, ServiceLifetime, implementationTypeOf } from "./service-descriptor.js";
import { type Class, type ServiceKey, type ServiceType, describeKey, isClass } from "./service-token.js";
import { getConventionalRegistrations, getDependencyOptions, type DependencyOptions } from "./injectable.js";
import { OnServiceRegisteredContext, type IAbpInterceptor, type IOnServiceRegisteredContext } from "./interception.js";
import { ObjectAccessor, objectAccessorToken } from "./object-accessor.js";
import { AbpException } from "../exception-handling/exceptions.js";
import { ServiceProvider, type IServiceProvider } from "./service-provider.js";
import { OptionsRegistry } from "../options/options-registry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImplementationInput<T> = Class<T & object> | { useClass: Class<T & object> } | { useFactory: (p: IServiceProvider) => T } | { useValue: T };

function toImplementation<T>(input: ImplementationInput<T>): ServiceImplementation<T> {
  if (typeof input === "function") return { kind: "class", type: input };
  if ("useClass" in input) return { kind: "class", type: input.useClass };
  if ("useFactory" in input) return { kind: "factory", factory: input.useFactory };
  return { kind: "value", value: input.useValue };
}

export interface IOnServiceActivatedContext {
  readonly instance: object;
  readonly implementationType: Class;
  readonly provider: IServiceProvider;
}

/**
 * Port of `IServiceCollection` plus ABP's extension methods (`OnRegistered`, `OnActivated`,
 * `AddObjectAccessor`, `GetSingletonInstance`, conventional registration, options).
 */
export class ServiceCollection {
  private readonly descriptors: ServiceDescriptor[] = [];
  private readonly registrationActions: ((ctx: IOnServiceRegisteredContext) => void)[] = [];
  private readonly activationActions: ((ctx: IOnServiceActivatedContext) => void)[] = [];
  private readonly interceptorCache = new Map<Class, readonly Class<IAbpInterceptor>[]>();
  private readonly conventionallyRegistered = new Set<Class>();
  readonly options = new OptionsRegistry();
  private readOnly = false;

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  makeReadOnly(): void {
    this.readOnly = true;
  }

  /** All descriptors in registration order (last one wins for single resolution). */
  toArray(): readonly ServiceDescriptor[] {
    return this.descriptors;
  }

  add<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>>, lifetime: ServiceLifetime, exposedKeys: readonly ServiceKey[] = [key]): this {
    this.ensureWritable();
    const descriptor: ServiceDescriptor = { key, lifetime, implementation: toImplementation(implementation), exposedKeys };
    this.descriptors.push(descriptor);
    this.triggerRegistered(descriptor);
    return this;
  }

  addSingleton<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>> = key as unknown as Class<ServiceType<K> & object>): this {
    return this.add(key, implementation, ServiceLifetime.Singleton);
  }
  addScoped<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>> = key as unknown as Class<ServiceType<K> & object>): this {
    return this.add(key, implementation, ServiceLifetime.Scoped);
  }
  addTransient<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>> = key as unknown as Class<ServiceType<K> & object>): this {
    return this.add(key, implementation, ServiceLifetime.Transient);
  }

  /** `services.TryAdd*` – registers only if the key has no registration yet. */
  tryAdd<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>>, lifetime: ServiceLifetime): this {
    if (this.isRegistered(key)) return this;
    return this.add(key, implementation, lifetime);
  }
  tryAddSingleton<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>> = key as unknown as Class<ServiceType<K> & object>): this {
    return this.tryAdd(key, implementation, ServiceLifetime.Singleton);
  }
  tryAddScoped<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>> = key as unknown as Class<ServiceType<K> & object>): this {
    return this.tryAdd(key, implementation, ServiceLifetime.Scoped);
  }
  tryAddTransient<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>> = key as unknown as Class<ServiceType<K> & object>): this {
    return this.tryAdd(key, implementation, ServiceLifetime.Transient);
  }

  /** `services.Replace(...)` – removes all registrations of the key first. */
  replace<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>>, lifetime: ServiceLifetime): this {
    this.removeAll(key);
    return this.add(key, implementation, lifetime);
  }
  replaceSingleton<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>>): this {
    return this.replace(key, implementation, ServiceLifetime.Singleton);
  }
  replaceScoped<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>>): this {
    return this.replace(key, implementation, ServiceLifetime.Scoped);
  }
  replaceTransient<K extends ServiceKey>(key: K, implementation: ImplementationInput<ServiceType<K>>): this {
    return this.replace(key, implementation, ServiceLifetime.Transient);
  }

  removeAll(key: ServiceKey): this {
    this.ensureWritable();
    for (let i = this.descriptors.length - 1; i >= 0; i--) {
      if (this.descriptors[i]!.key === key) this.descriptors.splice(i, 1);
    }
    return this;
  }

  isRegistered(key: ServiceKey): boolean {
    return this.descriptors.some((d) => d.key === key);
  }

  getDescriptors(key: ServiceKey): ServiceDescriptor[] {
    return this.descriptors.filter((d) => d.key === key);
  }

  /** `services.GetSingletonInstanceOrNull<T>()` – value registered with `useValue`. */
  getSingletonInstanceOrNull<K extends ServiceKey>(key: K): ServiceType<K> | undefined {
    for (let i = this.descriptors.length - 1; i >= 0; i--) {
      const d = this.descriptors[i]!;
      if (d.key === key && d.implementation.kind === "value") return d.implementation.value as ServiceType<K>;
    }
    return undefined;
  }

  getSingletonInstance<K extends ServiceKey>(key: K): ServiceType<K> {
    const value = this.getSingletonInstanceOrNull(key);
    if (value === undefined) throw new AbpException(`Could not find singleton service: ${describeKey(key)}`);
    return value;
  }

  /** `services.AddObjectAccessor<T>()`. */
  addObjectAccessor<T>(key: ServiceKey<T>, value?: T): ObjectAccessor<T> {
    const token = objectAccessorToken<T>(key);
    if (this.isRegistered(token)) throw new AbpException(`An object accessor is registered before for type: ${describeKey(key)}`);
    const accessor = new ObjectAccessor<T>(value);
    this.addSingleton(token, { useValue: accessor });
    return accessor;
  }

  tryAddObjectAccessor<T>(key: ServiceKey<T>, value?: T): ObjectAccessor<T> {
    const token = objectAccessorToken<T>(key);
    const existing = this.getSingletonInstanceOrNull(token);
    if (existing) return existing;
    return this.addObjectAccessor(key, value);
  }

  getObjectAccessorOrNull<T>(key: ServiceKey<T>): ObjectAccessor<T> | undefined {
    return this.getSingletonInstanceOrNull(objectAccessorToken<T>(key));
  }

  getObjectOrNull<T>(key: ServiceKey<T>): T | undefined {
    return this.getObjectAccessorOrNull(key)?.value;
  }

  /** `services.OnRegistered(...)` – lets modules add interceptors for implementation types. */
  onRegistered(action: (ctx: IOnServiceRegisteredContext) => void): void {
    this.registrationActions.push(action);
  }

  /** `services.OnActivated(...)` – runs after an instance is created (before interception). */
  onActivated(action: (ctx: IOnServiceActivatedContext) => void): void {
    this.activationActions.push(action);
  }

  getActivationActions(): readonly ((ctx: IOnServiceActivatedContext) => void)[] {
    return this.activationActions;
  }

  /** Interceptor types decided for an implementation type when it was registered. */
  getInterceptors(type: Class): readonly Class<IAbpInterceptor>[] {
    return this.interceptorCache.get(type) ?? [];
  }

  /**
   * Conventional registration (port of `services.AddAssembly` + `DefaultConventionalRegistrar`):
   * registers every class decorated with `@Transient/@Scoped/@Singleton/@Dependency`.
   */
  addConventionalRegistrations(): void {
    for (const reg of getConventionalRegistrations()) this.addType(reg.type);
  }

  /** `services.AddType(type)` – conventional registration for one class. */
  addType(type: Class, override?: DependencyOptions): void {
    if (this.conventionallyRegistered.has(type)) return;
    const options = { ...(getDependencyOptions(type) ?? {}), ...(override ?? {}) };
    const lifetime = options.lifetime;
    if (!lifetime) return;
    this.conventionallyRegistered.add(type);
    const exposes: ServiceKey[] = [...(options.exposes ?? [])];
    if (!options.excludeSelf && !exposes.includes(type)) exposes.unshift(type);
    for (const key of exposes) {
      if (options.replaceServices) this.removeAll(key);
      if (options.tryRegister && this.isRegistered(key)) continue;
      this.add(key as ServiceKey<object>, type, lifetime, exposes);
    }
  }

  addTypes(...types: Class[]): void {
    for (const t of types) this.addType(t);
  }

  buildServiceProvider(): IServiceProvider {
    this.makeReadOnly();
    return new ServiceProvider(this);
  }

  private triggerRegistered(descriptor: ServiceDescriptor): void {
    const type = implementationTypeOf(descriptor);
    if (!type || this.interceptorCache.has(type)) return;
    const ctx = new OnServiceRegisteredContext(type);
    for (const action of this.registrationActions) action(ctx);
    this.interceptorCache.set(type, ctx.interceptors.toArray());
  }

  private ensureWritable(): void {
    if (this.readOnly) throw new AbpException("The service collection is read-only after the service provider is built.");
  }
}

export function isServiceClass(value: unknown): value is Class {
  return isClass(value);
}
