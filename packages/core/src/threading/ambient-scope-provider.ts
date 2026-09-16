import { AsyncLocalStorage } from "node:async_hooks";
import { createToken } from "../dependency-injection/service-token.js";

/**
 * Port of `IAmbientScopeProvider<T>` / `AmbientDataContextAmbientScopeProvider<T>` on top of
 * `AsyncLocalStorage`. Used by `ICurrentTenant.Change`, `ICurrentPrincipalAccessor.Change`,
 * `IDataFilter.Enable/Disable`, `IUnitOfWorkManager` and the culture context.
 */
export interface IAmbientScopeProvider<T> {
  getValue(contextKey: string): T | undefined;
  /** Disposable style (`using`): sets the value for the rest of the current async flow. */
  beginScope(contextKey: string, value: T | undefined): Disposable;
  /** Callback style: sets the value only inside `fn` (safest across `await`). */
  run<R>(contextKey: string, value: T | undefined, fn: () => R): R;
}

type Store = ReadonlyMap<string, unknown>;

const storage = new AsyncLocalStorage<Store>();

function withKey(store: Store | undefined, key: string, value: unknown): Store {
  const next = new Map(store ?? []);
  next.set(key, value);
  return next;
}

export class AmbientScopeProvider<T> implements IAmbientScopeProvider<T> {
  getValue(contextKey: string): T | undefined {
    return storage.getStore()?.get(contextKey) as T | undefined;
  }

  beginScope(contextKey: string, value: T | undefined): Disposable {
    const previous = storage.getStore();
    storage.enterWith(withKey(previous, contextKey, value));
    let disposed = false;
    return {
      [Symbol.dispose]: () => {
        if (disposed) return;
        disposed = true;
        storage.enterWith(previous ?? new Map());
      },
    };
  }

  run<R>(contextKey: string, value: T | undefined, fn: () => R): R {
    return storage.run(withKey(storage.getStore(), contextKey, value), fn);
  }
}

export const IAmbientScopeProvider = createToken<IAmbientScopeProvider<unknown>>("IAmbientScopeProvider");

/** Shared ambient storage (one map for all keys) so nested scopes compose. */
export const ambientStorage = storage;
