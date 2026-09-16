/**
 * Service identity in the container.
 *
 * .NET ABP resolves services by `Type`. TypeScript has no runtime interfaces, so an
 * interface is represented by a branded symbol created with {@link createToken}, while
 * concrete classes can be used as keys directly (mirrors `services.AddTransient<MyClass>()`).
 */
export type ServiceToken<T = unknown> = symbol & { readonly __serviceType?: T };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Class<T = object> = new (...args: any[]) => T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractClass<T = object> = abstract new (...args: any[]) => T;

export type ServiceKey<T = unknown> = ServiceToken<T> | AbstractClass<T>;

/** Infers the service type carried by a key. */
export type ServiceType<K> = K extends ServiceToken<infer T> ? T : K extends AbstractClass<infer T> ? T : never;

export function createToken<T>(description: string): ServiceToken<T> {
  return Symbol(description) as ServiceToken<T>;
}

const keyedTokens = new WeakMap<symbol | object, Map<unknown, ServiceToken>>();

/**
 * Equivalent of a closed generic service type such as `IRepository<Book>`:
 * `keyedToken(IRepository, Book)` always returns the same token for the same pair.
 */
export function keyedToken<T>(base: ServiceKey, key: unknown): ServiceToken<T> {
  const baseKey: symbol | object = base;
  let map = keyedTokens.get(baseKey);
  if (!map) {
    map = new Map();
    keyedTokens.set(baseKey, map);
  }
  let token = map.get(key);
  if (!token) {
    token = createToken(`${describeKey(base)}<${describeKey(key)}>`);
    map.set(key, token);
  }
  return token as ServiceToken<T>;
}

export function describeKey(key: unknown): string {
  if (typeof key === "symbol") return key.description ?? key.toString();
  if (typeof key === "function") return key.name || "(anonymous class)";
  if (typeof key === "string") return key;
  return String(key);
}

export function isClass(value: unknown): value is Class {
  return typeof value === "function" && /^class\s/.test(Function.prototype.toString.call(value));
}
