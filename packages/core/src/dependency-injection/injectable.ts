import type { Class, ServiceKey } from "./service-token.js";
import { ServiceLifetime } from "./service-descriptor.js";

/**
 * Conventional registration metadata. Replaces ABP's marker interfaces
 * (`ITransientDependency`, `IScopedDependency`, `ISingletonDependency`) and the
 * `[Dependency]`, `[ExposeServices]` and `[DisableConventionalRegistration]` attributes.
 */
export interface DependencyOptions {
  lifetime?: ServiceLifetime;
  /** `services.TryAdd(...)` semantics: keep an existing registration. */
  tryRegister?: boolean;
  /** `services.Replace(...)` semantics: drop existing registrations for the exposed keys. */
  replaceServices?: boolean;
  /** Keys this class is exposed as, besides itself. */
  exposes?: readonly ServiceKey[];
  /** Register only under `exposes`, not under the class itself. */
  excludeSelf?: boolean;
}

export interface ConventionalRegistration {
  readonly type: Class;
  readonly options: Required<Pick<DependencyOptions, "lifetime">> & DependencyOptions;
}

const registry: ConventionalRegistration[] = [];
const registered = new Set<Class>();
const disabled = new WeakSet<Class>();
const metadata = new WeakMap<Class, DependencyOptions>();

/** All classes decorated for conventional registration, in definition order. */
export function getConventionalRegistrations(): readonly ConventionalRegistration[] {
  return registry;
}

export function getDependencyOptions(type: Class): DependencyOptions | undefined {
  return metadata.get(type);
}

function register(type: Class, options: DependencyOptions): void {
  const merged = { ...(metadata.get(type) ?? {}), ...options };
  metadata.set(type, merged);
  if (merged.lifetime && !registered.has(type) && !disabled.has(type)) {
    registered.add(type);
    registry.push({ type, options: { ...merged, lifetime: merged.lifetime } });
  }
}

type ClassDecorator = <C extends Class>(target: C) => C | void;

function lifetimeDecorator(lifetime: ServiceLifetime, exposes: readonly ServiceKey[], extra?: DependencyOptions): ClassDecorator {
  return (target) => {
    register(target, { ...extra, lifetime, exposes: [...(metadata.get(target)?.exposes ?? []), ...exposes] });
  };
}

/** Equivalent of implementing `ITransientDependency` (+ optional `[ExposeServices(...)]`). */
export function Transient(...exposes: ServiceKey[]): ClassDecorator {
  return lifetimeDecorator(ServiceLifetime.Transient, exposes);
}
/** Equivalent of implementing `IScopedDependency`. */
export function Scoped(...exposes: ServiceKey[]): ClassDecorator {
  return lifetimeDecorator(ServiceLifetime.Scoped, exposes);
}
/** Equivalent of implementing `ISingletonDependency`. */
export function Singleton(...exposes: ServiceKey[]): ClassDecorator {
  return lifetimeDecorator(ServiceLifetime.Singleton, exposes);
}
/** Equivalent of `[Dependency(ServiceLifetime.X, TryRegister = ..., ReplaceServices = ...)]`. */
export function Dependency(options: DependencyOptions): ClassDecorator {
  return (target) => {
    register(target, options);
  };
}
/** Equivalent of `[ExposeServices(typeof(IFoo))]`. Combine with a lifetime decorator. */
export function ExposeServices(...exposes: ServiceKey[]): ClassDecorator {
  return (target) => {
    register(target, { exposes: [...(metadata.get(target)?.exposes ?? []), ...exposes] });
  };
}
/** Equivalent of `[DisableConventionalRegistration]`. */
export function DisableConventionalRegistration(): ClassDecorator {
  return (target) => {
    disabled.add(target);
  };
}

/**
 * Constructor dependencies. A class declares `static inject = [TokenA, TokenB] as const`
 * and receives the resolved services positionally. Type-checked helper: {@link inject}.
 */
export interface Injectable {
  readonly inject?: readonly ServiceKey[];
}

export function injectKeysOf(type: Class): readonly ServiceKey[] {
  const keys = (type as Class & Injectable).inject;
  return Array.isArray(keys) ? keys : [];
}
