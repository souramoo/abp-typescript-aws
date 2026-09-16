import { AmbientScopeProvider, IAmbientScopeProvider, Singleton, createToken } from "@abp/core";

/**
 * Port of `ICorrelationIdProvider` (`Volo.Abp.Tracing`, part of the .NET core package). Defined here because
 * `@abp/core` does not ship it yet; HTTP adapters set it per request.
 */
export interface ICorrelationIdProvider {
  get(): string | undefined;
  /** Disposable style (`using`): the id stays current for the rest of the async flow until disposed. */
  change(correlationId: string | undefined): Disposable;
  /** Callback style: the id is current only inside `fn`. */
  run<R>(correlationId: string | undefined, fn: () => R): R;
}
export const ICorrelationIdProvider = createToken<ICorrelationIdProvider>("ICorrelationIdProvider");

const CorrelationIdKey = "Abp.Tracing.CorrelationId";

/** Port of `DefaultCorrelationIdProvider` on top of `AmbientScopeProvider`. */
@Singleton(ICorrelationIdProvider)
export class DefaultCorrelationIdProvider implements ICorrelationIdProvider {
  static readonly inject = [IAmbientScopeProvider] as const;
  static readonly instance = new DefaultCorrelationIdProvider(new AmbientScopeProvider<string>());

  constructor(private readonly ambientScopeProvider: IAmbientScopeProvider<string>) {}

  get(): string | undefined {
    return this.ambientScopeProvider.getValue(CorrelationIdKey);
  }

  change(correlationId: string | undefined): Disposable {
    return this.ambientScopeProvider.beginScope(CorrelationIdKey, correlationId);
  }

  run<R>(correlationId: string | undefined, fn: () => R): R {
    return this.ambientScopeProvider.run(CorrelationIdKey, correlationId, fn);
  }
}
