/** Port of `SemaphoreSlim`-style `KeyedLock`, `AsyncOneTimeRunner`, `TaskCache`. */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();
  private held = false;

  get isHeld(): boolean {
    return this.held;
  }

  /** Acquires the lock, waiting at most `timeoutMs` (0 = no wait); resolves undefined on timeout. */
  async tryAcquire(timeoutMs = 0, signal?: AbortSignal): Promise<Disposable | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) return undefined;
      if (!this.held) {
        this.held = true;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.held = false;
        };
        return { [Symbol.dispose]: release };
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, Math.min(10, Math.max(1, deadline - Date.now()))));
    }
  }

  /** Runs `fn` exclusively (`using (await semaphore.LockAsync())`). */
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await previous;
    this.held = true;
    try {
      return await fn();
    } finally {
      this.held = false;
      release();
    }
  }
}

export class KeyedLock<K = string> {
  private readonly locks = new Map<K, AsyncLock>();
  /** Port of `KeyedLock.TryLockAsync`: acquire or give up after `timeoutMs`. */
  tryLock(key: K, timeoutMs = 0, signal?: AbortSignal): Promise<Disposable | undefined> {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(key, lock);
    }
    return lock.tryAcquire(timeoutMs, signal);
  }
  async lock<T>(key: K, fn: () => Promise<T>): Promise<T> {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(key, lock);
    }
    return lock.lock(fn);
  }
}

export class AsyncOneTimeRunner {
  private promise: Promise<void> | undefined;
  run(action: () => Promise<void>): Promise<void> {
    if (!this.promise) this.promise = action();
    return this.promise;
  }
}

export class OneTimeRunner {
  private ran = false;
  run(action: () => void): void {
    if (this.ran) return;
    this.ran = true;
    action();
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

/** Port of `DisposeAction` / `AsyncDisposeFunc`. */
export class DisposeAction implements Disposable {
  constructor(private readonly action: () => void) {}
  [Symbol.dispose](): void {
    this.action();
  }
  dispose(): void {
    this.action();
  }
}
export class AsyncDisposeAction implements AsyncDisposable {
  constructor(private readonly action: () => Promise<void>) {}
  [Symbol.asyncDispose](): Promise<void> {
    return this.action();
  }
  dispose(): Promise<void> {
    return this.action();
  }
}
export const NullDisposable: Disposable = { [Symbol.dispose]: () => {} };
export const NullAsyncDisposable: AsyncDisposable = { [Symbol.asyncDispose]: async () => {} };
