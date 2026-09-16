import { createToken } from "../dependency-injection/service-token.js";

/** Port of `ICancellationTokenProvider` using `AbortSignal`. */
export interface ICancellationTokenProvider {
  readonly signal: AbortSignal | undefined;
  /** `FallbackToProvider(cancellationToken)`. */
  fallbackToProvider(signal?: AbortSignal): AbortSignal | undefined;
  use(signal: AbortSignal | undefined): Disposable;
}
export const ICancellationTokenProvider = createToken<ICancellationTokenProvider>("ICancellationTokenProvider");

export class NullCancellationTokenProvider implements ICancellationTokenProvider {
  static readonly instance = new NullCancellationTokenProvider();
  readonly signal = undefined;
  fallbackToProvider(signal?: AbortSignal): AbortSignal | undefined {
    return signal;
  }
  use(): Disposable {
    return { [Symbol.dispose]: () => {} };
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}
