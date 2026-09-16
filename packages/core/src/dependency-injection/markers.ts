import type { Class } from "./service-token.js";

/**
 * ABP uses marker interfaces (`IUnitOfWorkEnabled`, `IAuditingEnabled`, `IValidationEnabled`, …) and attributes
 * on classes/methods to drive interceptors. TypeScript interfaces vanish at runtime, so markers are class
 * decorators backed by a WeakSet; `has()` honours inheritance (a subclass of a marked class is marked).
 */
export interface ClassMarker {
  (): (target: Class) => void;
  mark(type: Class): void;
  has(type: Class | undefined): boolean;
  readonly markerName: string;
}

export function createClassMarker(name: string): ClassMarker {
  const marked = new WeakSet<Class>();
  const has = (type: Class | undefined): boolean => {
    let current: unknown = type;
    while (typeof current === "function" && current !== Function.prototype) {
      if (marked.has(current as Class)) return true;
      current = Object.getPrototypeOf(current);
    }
    return false;
  };
  const decorator = () => (target: Class) => {
    marked.add(target);
  };
  return Object.assign(decorator, { mark: (t: Class) => marked.add(t), has, markerName: name });
}

/**
 * Method-level metadata (port of method attributes such as `[UnitOfWork]`, `[Audited]`, `[DisableValidation]`).
 * `get()` looks up the prototype chain so overriding methods inherit metadata unless re-declared.
 */
export interface MethodMetadata<T> {
  (value: T): (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => void;
  set(type: Class, method: string, value: T): void;
  get(type: Class | undefined, method: string): T | undefined;
  /** Metadata declared on the class itself (applies to all methods); port of class-level attributes. */
  setForClass(type: Class, value: T): void;
  getForClass(type: Class | undefined): T | undefined;
  readonly metadataName: string;
}

export function createMethodMetadata<T>(name: string): MethodMetadata<T> {
  const perMethod = new WeakMap<object, Map<string, T>>();
  const perClass = new WeakMap<Class, T>();
  const decorator = (value: T) => (target: object, propertyKey: string | symbol) => {
    let map = perMethod.get(target);
    if (!map) {
      map = new Map();
      perMethod.set(target, map);
    }
    map.set(String(propertyKey), value);
  };
  const get = (type: Class | undefined, method: string): T | undefined => {
    let proto: unknown = type?.prototype;
    while (proto && proto !== Object.prototype) {
      const value = perMethod.get(proto as object)?.get(method);
      if (value !== undefined) return value;
      proto = Object.getPrototypeOf(proto);
    }
    return undefined;
  };
  const getForClass = (type: Class | undefined): T | undefined => {
    let current: unknown = type;
    while (typeof current === "function" && current !== Function.prototype) {
      const value = perClass.get(current as Class);
      if (value !== undefined) return value;
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  };
  return Object.assign(decorator, {
    set: (type: Class, method: string, value: T) => decorator(value)(type.prototype as object, method),
    get,
    setForClass: (type: Class, value: T) => perClass.set(type, value),
    getForClass,
    metadataName: name,
  });
}

/** Lists the public method names of a class (own + inherited, excluding Object.prototype). */
export function getMethodNames(type: Class): string[] {
  const names = new Set<string>();
  let proto: unknown = type.prototype;
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor") continue;
      const d = Object.getOwnPropertyDescriptor(proto, key);
      if (d && typeof d.value === "function") names.add(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

/** Port of `IAvoidDuplicateCrossCuttingConcerns`: tracks which concerns already ran for an instance. */
export const AppliedCrossCuttingConcerns = {
  key: Symbol("AppliedCrossCuttingConcerns"),
  isApplied(instance: object, concern: string): boolean {
    const set = (instance as Record<symbol, unknown>)[AppliedCrossCuttingConcerns.key];
    return set instanceof Set && set.has(concern);
  },
  apply(instance: object, concern: string): Disposable {
    const holder = instance as Record<symbol, unknown>;
    let set = holder[AppliedCrossCuttingConcerns.key];
    if (!(set instanceof Set)) {
      set = new Set<string>();
      Object.defineProperty(holder, AppliedCrossCuttingConcerns.key, { value: set, enumerable: false, configurable: true });
    }
    (set as Set<string>).add(concern);
    return { [Symbol.dispose]: () => (set as Set<string>).delete(concern) };
  },
};
