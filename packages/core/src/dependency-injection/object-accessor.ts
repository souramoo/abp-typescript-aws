import { createToken, keyedToken, type ServiceKey, type ServiceToken } from "./service-token.js";

/** Port of `IObjectAccessor<T>` / `ObjectAccessor<T>`. */
export interface IObjectAccessor<T> {
  readonly value: T | undefined;
}

export class ObjectAccessor<T> implements IObjectAccessor<T> {
  constructor(public value: T | undefined = undefined) {}
}

const IObjectAccessorBase = createToken<unknown>("IObjectAccessor");

export function objectAccessorToken<T>(key: ServiceKey<T>): ServiceToken<ObjectAccessor<T>> {
  return keyedToken<ObjectAccessor<T>>(IObjectAccessorBase, key);
}
