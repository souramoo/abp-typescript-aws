import { Check, Singleton, throwIfAborted } from "@abp/core";
import { IAbpDistributedLock, type IAbpDistributedLockHandle } from "./abp-distributed-lock.js";
import { IDistributedLockKeyNormalizer } from "./distributed-lock-key-normalizer.js";

interface Waiter {
  readonly grant: () => void;
  readonly cancel: () => void;
}

interface LockState {
  locked: boolean;
  readonly waiters: Waiter[];
}

/**
 * Port of the `KeyedLock.TryLockAsync(key, timeout, cancellationToken)` semantics used by `LocalAbpDistributedLock`:
 * one exclusive lock per key, hand-over to the next waiter on release, wait bounded by a timeout.
 */
export class LocalKeyedLock {
  private readonly states = new Map<string, LockState>();

  async tryLock(key: string, timeoutMs = 0, signal?: AbortSignal): Promise<Disposable | undefined> {
    throwIfAborted(signal);
    let state = this.states.get(key);
    if (!state) {
      state = { locked: false, waiters: [] };
      this.states.set(key, state);
    }
    if (!state.locked) {
      state.locked = true;
      return this.releaser(key);
    }
    if (timeoutMs <= 0) return undefined;

    const acquired = await this.wait(state, timeoutMs, signal);
    return acquired ? this.releaser(key) : undefined;
  }

  isLocked(key: string): boolean {
    return this.states.get(key)?.locked === true;
  }

  private wait(state: LockState, timeoutMs: number, signal: AbortSignal | undefined): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const waiter: Waiter = {
        grant: () => {
          cleanup();
          resolve(true);
        },
        cancel: onAbort,
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      state.waiters.push(waiter);
    });
  }

  private releaser(key: string): Disposable {
    let released = false;
    return {
      [Symbol.dispose]: () => {
        if (released) return;
        released = true;
        this.release(key);
      },
    };
  }

  private release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    const next = state.waiters.shift();
    if (next) {
      next.grant();
      return;
    }
    state.locked = false;
    this.states.delete(key);
  }
}

/** Port of `LocalAbpDistributedLockHandle`. */
export class LocalAbpDistributedLockHandle implements IAbpDistributedLockHandle {
  constructor(private readonly disposable: Disposable) {}

  async dispose(): Promise<void> {
    this.disposable[Symbol.dispose]();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

/**
 * Port of `LocalAbpDistributedLock`: in-process locking. Correct for a single process only; the AWS package
 * replaces it with a DynamoDB conditional-write implementation (`@Dependency({ replaceServices: true })`).
 */
@Singleton(IAbpDistributedLock)
export class LocalAbpDistributedLock implements IAbpDistributedLock {
  static readonly inject = [IDistributedLockKeyNormalizer] as const;
  protected readonly keyedLock = new LocalKeyedLock();

  constructor(protected readonly distributedLockKeyNormalizer: IDistributedLockKeyNormalizer) {}

  async tryAcquire(name: string, timeoutMs = 0, signal?: AbortSignal): Promise<IAbpDistributedLockHandle | undefined> {
    Check.notNullOrWhiteSpace(name, "name");
    const key = this.distributedLockKeyNormalizer.normalizeKey(name);
    const disposable = await this.keyedLock.tryLock(key, timeoutMs, signal);
    return disposable === undefined ? undefined : new LocalAbpDistributedLockHandle(disposable);
  }
}

/** Port of `NullAbpDistributedLock`: never blocks; useful when locking is not required or in tests. */
export class NullAbpDistributedLock implements IAbpDistributedLock {
  static readonly instance = new NullAbpDistributedLock();

  async tryAcquire(_name: string, _timeoutMs?: number, _signal?: AbortSignal): Promise<IAbpDistributedLockHandle | undefined> {
    return new LocalAbpDistributedLockHandle({ [Symbol.dispose]: () => {} });
  }
}
