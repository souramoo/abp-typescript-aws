import type { Class } from "./service-token.js";
import type { IServiceProvider } from "./service-provider.js";
import { TypeList } from "../collections/type-list.js";

/** Port of `IAbpMethodInvocation`. */
export interface IAbpMethodInvocation {
  readonly targetObject: object;
  readonly targetType: Class;
  readonly method: string;
  args: unknown[];
  returnValue: unknown;
  proceed(): Promise<void>;
}

/** Port of `IAbpInterceptor`. Interceptors are resolved from the container per invocation. */
export interface IAbpInterceptor {
  intercept(invocation: IAbpMethodInvocation): Promise<void>;
}

export abstract class AbpInterceptor implements IAbpInterceptor {
  abstract intercept(invocation: IAbpMethodInvocation): Promise<void>;
}

/** Port of `IOnServiceRegistredContext`. */
export interface IOnServiceRegisteredContext {
  readonly implementationType: Class;
  readonly interceptors: TypeList<IAbpInterceptor>;
}

export class OnServiceRegisteredContext implements IOnServiceRegisteredContext {
  readonly interceptors = new TypeList<IAbpInterceptor>();
  constructor(readonly implementationType: Class) {}
}

const nonInterceptedMethods = new WeakMap<object, Set<string>>();

/** Method decorator: skips interception for this method (e.g. synchronous helpers). */
export function DisableInterception() {
  return (target: object, propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => {
    let set = nonInterceptedMethods.get(target);
    if (!set) {
      set = new Set();
      nonInterceptedMethods.set(target, set);
    }
    set.add(String(propertyKey));
  };
}

function isInterceptable(instance: object, name: string | symbol): boolean {
  if (typeof name === "symbol" || name === "constructor") return false;
  // Only prototype methods are intercepted (ABP intercepts virtual methods); own data properties
  // holding functions or classes (e.g. `entityType`) are returned untouched.
  if (Object.prototype.hasOwnProperty.call(instance, name)) return false;
  let proto = Object.getPrototypeOf(instance) as object | null;
  while (proto && proto !== Object.prototype) {
    if (nonInterceptedMethods.get(proto)?.has(name)) return false;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return true;
}

/**
 * Wraps an instance in a Proxy so every public method call runs through the interceptor chain
 * (port of ABP's Castle DynamicProxy based interception). Intercepted methods always return a Promise.
 */
export function createInterceptedProxy<T extends object>(
  instance: T,
  targetType: Class,
  interceptorTypes: readonly Class<IAbpInterceptor>[],
  provider: IServiceProvider,
): T {
  if (interceptorTypes.length === 0) return instance;
  const methodCache = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  return new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function" || !isInterceptable(target, prop)) return value;
      const name = prop as string;
      let wrapped = methodCache.get(name);
      if (!wrapped) {
        const original = value as (...args: unknown[]) => unknown;
        wrapped = async (...args: unknown[]) => {
          const interceptors = interceptorTypes.map((t) => provider.getRequired(t));
          const invocation = new MethodInvocation(target, targetType, name, args, original, interceptors);
          await invocation.proceed();
          return invocation.returnValue;
        };
        methodCache.set(name, wrapped);
      }
      return wrapped;
    },
  });
}

class MethodInvocation implements IAbpMethodInvocation {
  returnValue: unknown = undefined;
  private index = 0;
  constructor(
    readonly targetObject: object,
    readonly targetType: Class,
    readonly method: string,
    public args: unknown[],
    private readonly original: (...args: unknown[]) => unknown,
    private readonly interceptors: readonly IAbpInterceptor[],
  ) {}

  async proceed(): Promise<void> {
    if (this.index < this.interceptors.length) {
      const interceptor = this.interceptors[this.index++]!;
      await interceptor.intercept(this);
      return;
    }
    this.returnValue = await this.original.apply(this.targetObject, this.args);
  }
}
