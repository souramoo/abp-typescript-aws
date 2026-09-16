import { AbpException, Check, Transient, createToken, optionsToken, type Class, type IOptions, type ServiceKey } from "@abp/core";
import { ConnectionStrings } from "@abp/multi-tenancy-abstractions";

export { ConnectionStrings };

/** Port of `AbpDatabaseInfo`. */
export class AbpDatabaseInfo {
  readonly mappedConnections = new Set<string>();
  /** Set to false if this database can not be owned by tenants. Default: true. */
  isUsedByTenants = true;

  constructor(readonly databaseName: string) {}

  mapConnection(...connectionNames: string[]): void {
    for (const name of connectionNames) this.mappedConnections.add(name);
  }
}

/** Port of `AbpDatabaseInfoDictionary`. */
export class AbpDatabaseInfoDictionary extends Map<string, AbpDatabaseInfo> {
  private connectionIndex = new Map<string, AbpDatabaseInfo>();

  getMappedDatabaseOrNull(connectionStringName: string): AbpDatabaseInfo | undefined {
    return this.connectionIndex.get(connectionStringName);
  }

  configure(databaseName: string, configureAction: (database: AbpDatabaseInfo) => void): this {
    let database = this.get(databaseName);
    if (!database) {
      database = new AbpDatabaseInfo(databaseName);
      this.set(databaseName, database);
    }
    configureAction(database);
    return this;
  }

  /** Must be called after the dictionary changes (done by `AbpDataModule.postConfigureServices`). */
  refreshIndexes(): void {
    this.connectionIndex = new Map();
    for (const database of this.values()) {
      for (const mapped of database.mappedConnections) {
        if (this.connectionIndex.has(mapped)) throw new AbpException(`A connection name can not map to multiple databases: ${mapped}.`);
        this.connectionIndex.set(mapped, database);
      }
    }
  }
}

/** Port of `AbpDbConnectionOptions`. */
export class AbpDbConnectionOptions {
  connectionStrings = new ConnectionStrings();
  databases = new AbpDatabaseInfoDictionary();

  getConnectionStringOrNull(connectionStringName: string, fallbackToDatabaseMappings = true, fallbackToDefault = true): string | undefined {
    const connectionString = this.connectionStrings.getOrDefault(connectionStringName);
    if (connectionString) return connectionString;

    if (fallbackToDatabaseMappings) {
      const database = this.databases.getMappedDatabaseOrNull(connectionStringName);
      if (database) {
        const mapped = this.connectionStrings.getOrDefault(database.databaseName);
        if (mapped) return mapped;
      }
    }

    if (fallbackToDefault) {
      const defaultConnectionString = this.connectionStrings.default;
      if (defaultConnectionString && defaultConnectionString.trim() !== "") return defaultConnectionString;
    }

    return undefined;
  }
}

/** Port of `IConnectionStringResolver`. Returns undefined when nothing is configured (.NET returns null there too). */
export interface IConnectionStringResolver {
  resolve(connectionStringName?: string): Promise<string | undefined>;
}
export const IConnectionStringResolver = createToken<IConnectionStringResolver>("IConnectionStringResolver");

/** Port of `DefaultConnectionStringResolver`. */
@Transient(IConnectionStringResolver)
export class DefaultConnectionStringResolver implements IConnectionStringResolver {
  static readonly inject: readonly ServiceKey[] = [optionsToken(AbpDbConnectionOptions)];
  protected readonly options: AbpDbConnectionOptions;

  constructor(options: IOptions<AbpDbConnectionOptions>) {
    this.options = options.value;
  }

  async resolve(connectionStringName?: string): Promise<string | undefined> {
    if (connectionStringName === undefined) return this.options.connectionStrings.default;
    return this.options.getConnectionStringOrNull(connectionStringName);
  }
}

const connectionStringNames = new WeakMap<object, string>();

/** Port of `[ConnectionStringName("AbpIdentity")]` on a db-context class. */
export function ConnectionStringName(name: string) {
  Check.notNullOrWhiteSpace(name, "name");
  return (target: object): void => {
    connectionStringNames.set(target, name);
  };
}

/** Port of `ConnectionStringNameAttribute.GetConnStringName(type)`: the attribute name or the class name. */
export function getConnectionStringName(type: Class): string {
  let current: unknown = type;
  while (typeof current === "function" && current !== Function.prototype) {
    const name = connectionStringNames.get(current);
    if (name !== undefined) return name;
    current = Object.getPrototypeOf(current);
  }
  return type.name;
}

/** Port of `ConnectionStringResolverExtensions.ResolveAsync<T>()`. */
export function resolveConnectionStringFor(resolver: IConnectionStringResolver, type: Class): Promise<string | undefined> {
  return resolver.resolve(getConnectionStringName(type));
}

/** Port of `AbpConnectionStringCheckResult`. */
export interface AbpConnectionStringCheckResult {
  connected: boolean;
  databaseExists: boolean;
}

/** Port of `IConnectionStringChecker`. */
export interface IConnectionStringChecker {
  check(connectionString: string): Promise<AbpConnectionStringCheckResult>;
}
export const IConnectionStringChecker = createToken<IConnectionStringChecker>("IConnectionStringChecker");

@Transient(IConnectionStringChecker)
export class DefaultConnectionStringChecker implements IConnectionStringChecker {
  async check(): Promise<AbpConnectionStringCheckResult> {
    return { connected: false, databaseExists: false };
  }
}
