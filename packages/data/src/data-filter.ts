import { AbpAmbientKeys, IAmbientScopeProvider, NullDisposable, Singleton, createToken, optionsToken, type IOptions, type ISoftDelete } from "@abp/core";
import { MultiTenantDataFilterName, type IMultiTenant } from "@abp/multi-tenancy-abstractions";

/**
 * Identifies a data filter by name. .NET keys filters by the marker interface type (`IDataFilter<ISoftDelete>`);
 * interfaces are erased here, so a key carries the name and the filter type as a phantom parameter.
 */
export interface DataFilterKey<TFilter = unknown> {
  readonly name: string;
  readonly ambientKey: string;
  readonly __filter?: TFilter;
}

const keys = new Map<string, DataFilterKey>();

/** Returns the same key object for the same name. */
export function createDataFilterKey<TFilter = unknown>(name: string): DataFilterKey<TFilter> {
  let key = keys.get(name);
  if (!key) {
    key = { name, ambientKey: AbpAmbientKeys.dataFilter(name) };
    keys.set(name, key);
  }
  return key as DataFilterKey<TFilter>;
}

export const SoftDeleteFilter = createDataFilterKey<ISoftDelete>("ISoftDelete");
export const MultiTenantFilter = createDataFilterKey<IMultiTenant>(MultiTenantDataFilterName);

/** Port of `DataFilterState`. */
export class DataFilterState {
  constructor(public isEnabled: boolean) {}

  clone(): DataFilterState {
    return new DataFilterState(this.isEnabled);
  }
}

/** Port of `AbpDataFilterOptions`. Filters without a default state are enabled. */
export class AbpDataFilterOptions {
  readonly defaultStates = new Map<DataFilterKey, DataFilterState>();
}

/** Port of `IDataFilter<TFilter>` (one filter). */
export interface IDataFilterOf<TFilter = unknown> {
  readonly key: DataFilterKey<TFilter>;
  readonly isEnabled: boolean;
  enable(): Disposable;
  disable(): Disposable;
}

/** Port of `IDataFilter` (+ `DataFilterExtensions` composites) with `run*` callback variants. */
export interface IDataFilter {
  isEnabled(key: DataFilterKey): boolean;
  /** Disposable style (`using`): the state stays for the rest of the async flow until disposed. */
  enable(...keys: DataFilterKey[]): Disposable;
  disable(...keys: DataFilterKey[]): Disposable;
  /** Callback style: the state applies only inside `fn` (safe across `await` boundaries). */
  runEnabled<R>(keys: DataFilterKey | readonly DataFilterKey[], fn: () => R): R;
  runDisabled<R>(keys: DataFilterKey | readonly DataFilterKey[], fn: () => R): R;
  for<TFilter>(key: DataFilterKey<TFilter>): IDataFilterOf<TFilter>;
}
export const IDataFilter = createToken<IDataFilter>("IDataFilter");

/** Port of `DataFilter` + `DataFilter<TFilter>` on top of `AmbientScopeProvider` (`AbpAmbientKeys.dataFilter(name)`). */
@Singleton(IDataFilter)
export class DataFilter implements IDataFilter {
  static readonly inject = [IAmbientScopeProvider, optionsToken(AbpDataFilterOptions)] as const;
  private readonly options: AbpDataFilterOptions;
  private readonly filters = new Map<DataFilterKey, IDataFilterOf>();

  constructor(
    private readonly ambientScopeProvider: IAmbientScopeProvider<boolean>,
    options: IOptions<AbpDataFilterOptions>,
  ) {
    this.options = options.value;
  }

  isEnabled(key: DataFilterKey): boolean {
    return this.ambientScopeProvider.getValue(key.ambientKey) ?? this.options.defaultStates.get(key)?.isEnabled ?? true;
  }

  enable(...keys: DataFilterKey[]): Disposable {
    return this.setMany(keys, true);
  }

  disable(...keys: DataFilterKey[]): Disposable {
    return this.setMany(keys, false);
  }

  runEnabled<R>(keys: DataFilterKey | readonly DataFilterKey[], fn: () => R): R {
    return this.runMany(Array.isArray(keys) ? keys : [keys as DataFilterKey], true, fn);
  }

  runDisabled<R>(keys: DataFilterKey | readonly DataFilterKey[], fn: () => R): R {
    return this.runMany(Array.isArray(keys) ? keys : [keys as DataFilterKey], false, fn);
  }

  for<TFilter>(key: DataFilterKey<TFilter>): IDataFilterOf<TFilter> {
    let filter = this.filters.get(key);
    if (!filter) {
      filter = {
        key,
        isEnabled: false,
        enable: () => this.enable(key),
        disable: () => this.disable(key),
      };
      Object.defineProperty(filter, "isEnabled", { get: () => this.isEnabled(key), enumerable: true });
      this.filters.set(key, filter);
    }
    return filter as IDataFilterOf<TFilter>;
  }

  private setMany(keys: readonly DataFilterKey[], enabled: boolean): Disposable {
    const scopes = keys.filter((k) => this.isEnabled(k) !== enabled).map((k) => this.ambientScopeProvider.beginScope(k.ambientKey, enabled));
    if (scopes.length === 0) return NullDisposable;
    let disposed = false;
    return {
      [Symbol.dispose]: () => {
        if (disposed) return;
        disposed = true;
        for (const scope of scopes.reverse()) scope[Symbol.dispose]();
      },
    };
  }

  private runMany<R>(keys: readonly DataFilterKey[], enabled: boolean, fn: () => R): R {
    const [first, ...rest] = keys;
    if (!first) return fn();
    return this.ambientScopeProvider.run(first.ambientKey, enabled, () => this.runMany(rest, enabled, fn));
  }
}
