/** Port of `SemaphoreSlim`-style `KeyedLock`, `AsyncOneTimeRunner`, `TaskCache`. */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  /** Runs `fn` exclusively (`using (await semaphore.LockAsync())`). */
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class KeyedLock<K = string> {
  private readonly locks = new Map<K, AsyncLock>();
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
