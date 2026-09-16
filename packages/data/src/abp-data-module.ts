import { AbpModule, DependsOn, IConfiguration, ServiceCollection, objectAccessorToken, type Class, type IServiceProvider, type ServiceConfigurationContext } from "@abp/core";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpUnitOfWorkModule } from "@abp/uow";
import { AbpDataMigrationEnvironment } from "./common.js";
import { AbpDbConnectionOptions } from "./connection-strings.js";
import { AbpDataSeedOptions, DataSeedContributor, type IDataSeedContributor } from "./data-seeding.js";

/** Port of `AbpDataModule`. Binds `AbpDbConnectionOptions.connectionStrings` from the `ConnectionStrings` configuration section. */
@DependsOn(AbpUnitOfWorkModule, AbpMultiTenancyAbstractionsModule)
export class AbpDataModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    autoAddDataSeedContributors(context.services);
  }

  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    if (!configuration) return;
    const section = configuration.getSection("ConnectionStrings");
    this.configure(AbpDbConnectionOptions, (options) => {
      if (!section.exists()) return;
      for (const [name, value] of Object.entries(section.toObject())) {
        if (typeof value === "string") options.connectionStrings.set(name, value);
      }
    });
  }

  override postConfigureServices(): void {
    this.configure(AbpDbConnectionOptions, (options) => {
      options.databases.refreshIndexes();
    });
  }
}

function autoAddDataSeedContributors(services: ServiceCollection): void {
  const contributors: Class<IDataSeedContributor>[] = [];
  services.onRegistered((context) => {
    if (DataSeedContributor.has(context.implementationType)) contributors.push(context.implementationType as Class<IDataSeedContributor>);
  });
  services.options.configure(AbpDataSeedOptions, (options) => {
    options.contributors.addRange(contributors);
  });
}

/* Port of `AbpDataMigrationEnvironmentExtensions`. */

export function addDataMigrationEnvironment(services: ServiceCollection, environment: AbpDataMigrationEnvironment = new AbpDataMigrationEnvironment()): void {
  services.tryAddObjectAccessor(AbpDataMigrationEnvironment, environment);
}

export function isDataMigrationEnvironment(servicesOrProvider: ServiceCollection | IServiceProvider): boolean {
  if (servicesOrProvider instanceof ServiceCollection) return servicesOrProvider.getObjectOrNull(AbpDataMigrationEnvironment) !== undefined;
  return servicesOrProvider.get(objectAccessorToken(AbpDataMigrationEnvironment))?.value !== undefined;
}
