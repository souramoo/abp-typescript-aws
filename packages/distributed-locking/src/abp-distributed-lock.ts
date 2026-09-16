import { createToken } from "@abp/core";

/** Port of `IAbpDistributedLockHandle`: releases the lock when disposed (`await using handle = ...`). */
export interface IAbpDistributedLockHandle extends AsyncDisposable {
  dispose(): Promise<void>;
}

/** Port of `IAbpDistributedLock`. */
export interface IAbpDistributedLock {
  /**
   * Tries to acquire a named lock. Returns a handle to release the lock, or `undefined` if the lock could
   * not be acquired within `timeoutMs` (default 0: give up immediately). `signal` cancels the wait.
   */
  tryAcquire(name: string, timeoutMs?: number, signal?: AbortSignal): Promise<IAbpDistributedLockHandle | undefined>;
}
export const IAbpDistributedLock = createToken<IAbpDistributedLock>("IAbpDistributedLock");
