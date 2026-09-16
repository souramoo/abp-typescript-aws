import { Dependency, IRootServiceProvider, Transient, optionsToken, type Guid, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpDbConnectionOptions, DefaultConnectionStringResolver, IConnectionStringResolver } from "@abp/data";
import { ConnectionStrings, ICurrentTenant, ITenantStore, type TenantConfiguration } from "@abp/multi-tenancy-abstractions";

/** Port of `MultiTenantConnectionStringResolver`: replaces `DefaultConnectionStringResolver` to honour tenant connection strings. */
@Dependency({ replaceServices: true })
@Transient(IConnectionStringResolver)
export class MultiTenantConnectionStringResolver extends DefaultConnectionStringResolver {
  static override readonly inject = [optionsToken(AbpDbConnectionOptions), ICurrentTenant, IRootServiceProvider] as const;

  constructor(
    options: IOptions<AbpDbConnectionOptions>,
    private readonly currentTenant: ICurrentTenant,
    private readonly serviceProvider: IServiceProvider,
  ) {
    super(options);
  }

  override async resolve(connectionStringName?: string): Promise<string | undefined> {
    if (this.currentTenant.id === undefined) return super.resolve(connectionStringName);

    const tenant = await this.findTenantConfiguration(this.currentTenant.id);
    if (!tenant || !tenant.connectionStrings || tenant.connectionStrings.isNullOrEmpty()) return super.resolve(connectionStringName);

    const tenantDefaultConnectionString = tenant.connectionStrings.default;
    if (connectionStringName === undefined || connectionStringName === ConnectionStrings.DefaultConnectionStringName) {
      return tenantDefaultConnectionString?.trim() ? tenantDefaultConnectionString : this.options.connectionStrings.default;
    }

    const connString = tenant.connectionStrings.getOrDefault(connectionStringName);
    if (connString?.trim()) return connString;

    const database = this.options.databases.getMappedDatabaseOrNull(connectionStringName);
    if (database?.isUsedByTenants) {
      const mapped = tenant.connectionStrings.getOrDefault(database.databaseName);
      if (mapped?.trim()) return mapped;
    }

    if (tenantDefaultConnectionString?.trim()) return tenantDefaultConnectionString;
    return super.resolve(connectionStringName);
  }

  protected async findTenantConfiguration(tenantId: Guid): Promise<TenantConfiguration | undefined> {
    const scope = this.serviceProvider.createScope();
    try {
      return await scope.serviceProvider.getRequired(ITenantStore).findById(tenantId);
    } finally {
      await scope.dispose();
    }
  }
}
