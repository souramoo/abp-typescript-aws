import type { Class, ServiceKey } from "./service-token.js";
import type { IServiceProvider } from "./service-provider.js";

export enum ServiceLifetime {
  Singleton = "singleton",
  Scoped = "scoped",
  Transient = "transient",
}

export type ServiceImplementation<T = unknown> =
  | { readonly kind: "class"; readonly type: Class<T & object> }
  | { readonly kind: "factory"; readonly factory: (provider: IServiceProvider) => T }
  | { readonly kind: "value"; readonly value: T };

export interface ServiceDescriptor<T = unknown> {
  readonly key: ServiceKey<T>;
  readonly lifetime: ServiceLifetime;
  readonly implementation: ServiceImplementation<T>;
  /**
   * All keys this implementation was exposed under (conventional registration). Instances
   * are shared between those keys within a lifetime scope, like ABP's `ExposeServices`.
   */
  readonly exposedKeys: readonly ServiceKey[];
}

/** The implementation class of a descriptor if it is class-based. */
export function implementationTypeOf(descriptor: ServiceDescriptor): Class | undefined {
  return descriptor.implementation.kind === "class" ? descriptor.implementation.type : undefined;
}
