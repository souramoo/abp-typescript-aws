/** Port of `ConnectionStrings` (`Dictionary<string, string?>` with a `Default` entry). */
export class ConnectionStrings extends Map<string, string | undefined> {
  static readonly DefaultConnectionStringName = "Default";

  constructor(entries?: Iterable<readonly [string, string | undefined]> | Record<string, string | undefined>) {
    super(entries === undefined ? undefined : Symbol.iterator in entries ? entries : Object.entries(entries));
  }

  get default(): string | undefined {
    return this.get(ConnectionStrings.DefaultConnectionStringName);
  }

  set default(value: string | undefined) {
    this.set(ConnectionStrings.DefaultConnectionStringName, value);
  }

  /** `dictionary.GetOrDefault(name)`. */
  getOrDefault(name: string): string | undefined {
    return this.get(name);
  }

  isNullOrEmpty(): boolean {
    return this.size === 0;
  }
}
