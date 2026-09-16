import { AbpModule, DependsOn, IConfiguration, ILoggerFactory, ServiceLifetime, optionsToken, type ServiceConfigurationContext } from "@abp/core";
import { IConnectionStringResolver } from "@abp/data";
import { AbpDddDomainModule } from "@abp/ddd-domain";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IUnitOfWorkManager } from "@abp/uow";
import { AbpDynamoDbOptions } from "./abp-dynamodb-options.js";
import { DefaultDynamoDbClientFactory, IDynamoDbClientFactory } from "./dynamodb-client-factory.js";
import { UnitOfWorkDynamoDbContextProvider, dbContextTypeOfProviderToken } from "./dynamodb-context-provider.js";
import "./dynamodb-entity-serializer.js";
import "./dynamodb-table-manager.js";

/**
 * Port of `AbpMongoDbModule`. The open-generic `IMongoDbContextProvider<>` registration becomes a fallback resolver
 * for `dynamoDbContextProviderToken(DbContext)`; the table name falls back to `ConnectionStrings:Default`, then
 * `ABP_DYNAMODB_TABLE`.
 */
@DependsOn(AbpDddDomainModule)
export class AbpDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    this.postConfigure(AbpDynamoDbOptions, (options) => {
      options.tableName ??= configuration?.get("ConnectionStrings:Default") ?? process.env["ABP_DYNAMODB_TABLE"];
    });

    context.services.tryAddSingleton(IDynamoDbClientFactory, DefaultDynamoDbClientFactory);
    context.services.addFallbackResolver((key) => {
      const dbContextType = dbContextTypeOfProviderToken(key);
      if (!dbContextType) return undefined;
      return {
        lifetime: ServiceLifetime.Transient,
        implementation: {
          useFactory: (p) =>
            new UnitOfWorkDynamoDbContextProvider(
              p.getRequired(IUnitOfWorkManager),
              p.getRequired(IConnectionStringResolver),
              p.getRequired(ICurrentTenant),
              p.getRequired(IDynamoDbClientFactory),
              p.getRequired(optionsToken(AbpDynamoDbOptions)),
              p.getRequired(ILoggerFactory),
              dbContextType,
            ),
        },
      };
    });
  }
}
