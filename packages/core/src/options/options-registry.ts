import { createToken, keyedToken, type Class, type ServiceToken } from "../dependency-injection/service-token.js";

/** An options class: a plain class with a parameterless constructor and default values. */
export type OptionsClass<T extends object = object> = new () => T;

export type OptionsAction<T> = (options: T) => void;

/** Port of `IOptions<T>`. Resolved via `optionsToken(MyOptions)` or `provider.getOptions(MyOptions)`. */
export interface IOptions<T extends object> {
  readonly value: T;
}

const IOptionsBase = createToken<unknown>("IOptions");
const tokenToClass = new Map<ServiceToken, OptionsClass>();
export function optionsToken<T extends object>(optionsClass: OptionsClass<T>): ServiceToken<IOptions<T>> {
  const token = keyedToken<IOptions<T>>(IOptionsBase, optionsClass);
  tokenToClass.set(token, optionsClass);
  return token;
}
/** Reverse lookup used by the service provider to serve `IOptions<T>` without explicit registration. */
export function optionsClassOf(token: unknown): OptionsClass | undefined {
  return typeof token === "symbol" ? tokenToClass.get(token as ServiceToken) : undefined;
}

interface OptionsEntry {
  pre: OptionsAction<object>[];
  configure: OptionsAction<object>[];
  post: OptionsAction<object>[];
}

/**
 * Port of the .NET options pipeline ABP relies on: `PreConfigure<T>`, `Configure<T>`, `PostConfigure<T>`,
 * and `ExecutePreConfiguredActions<T>`.
 */
export class OptionsRegistry {
  private readonly entries = new Map<Class, OptionsEntry>();

  private entry(cls: Class): OptionsEntry {
    let e = this.entries.get(cls);
    if (!e) {
      e = { pre: [], configure: [], post: [] };
      this.entries.set(cls, e);
    }
    return e;
  }

  preConfigure<T extends object>(cls: OptionsClass<T>, action: OptionsAction<T>): void {
    this.entry(cls).pre.push(action as OptionsAction<object>);
  }
  configure<T extends object>(cls: OptionsClass<T>, action: OptionsAction<T>): void {
    this.entry(cls).configure.push(action as OptionsAction<object>);
  }
  postConfigure<T extends object>(cls: OptionsClass<T>, action: OptionsAction<T>): void {
    this.entry(cls).post.push(action as OptionsAction<object>);
  }

  /** `services.ExecutePreConfiguredActions<T>()`: a fresh instance with only pre-configure actions applied. */
  executePreConfiguredActions<T extends object>(cls: OptionsClass<T>): T {
    const options = new cls();
    for (const action of this.entry(cls).pre) action(options);
    return options;
  }

  /** Builds the final options value: pre → configure → post. */
  build<T extends object>(cls: OptionsClass<T>): T {
    const options = new cls();
    const e = this.entry(cls);
    for (const action of [...e.pre, ...e.configure, ...e.post]) action(options);
    return options;
  }
}

/** Singleton-cached `IOptions<T>` implementation. */
export class OptionsManager<T extends object> implements IOptions<T> {
  private cached: T | undefined;
  constructor(
    private readonly registry: OptionsRegistry,
    private readonly cls: OptionsClass<T>,
  ) {}
  get value(): T {
    if (this.cached === undefined) this.cached = this.registry.build(this.cls);
    return this.cached;
  }
}
