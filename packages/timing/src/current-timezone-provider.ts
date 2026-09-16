import { AmbientScopeProvider, Singleton, createToken } from "@abp/core";

/**
 * Port of `ICurrentTimezoneProvider` + `CurrentTimezoneProviderExtensions.Change`. The setter of .NET becomes
 * `change`/`run` scopes (ambient, `AsyncLocalStorage`); the settings layer sets it from `TimingSettingNames.TimeZone`.
 */
export interface ICurrentTimezoneProvider {
  readonly timeZone: string | undefined;
  change(timeZone: string | undefined): Disposable;
  run<R>(timeZone: string | undefined, fn: () => R): R;
}
export const ICurrentTimezoneProvider = createToken<ICurrentTimezoneProvider>("ICurrentTimezoneProvider");

@Singleton(ICurrentTimezoneProvider)
export class CurrentTimezoneProvider implements ICurrentTimezoneProvider {
  static readonly contextKey = "Abp.Timing.CurrentTimezone";
  private readonly scope = new AmbientScopeProvider<string>();

  get timeZone(): string | undefined {
    return this.scope.getValue(CurrentTimezoneProvider.contextKey);
  }

  change(timeZone: string | undefined): Disposable {
    return this.scope.beginScope(CurrentTimezoneProvider.contextKey, timeZone);
  }

  run<R>(timeZone: string | undefined, fn: () => R): R {
    return this.scope.run(CurrentTimezoneProvider.contextKey, timeZone, fn);
  }
}
