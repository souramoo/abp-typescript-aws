import { IRootServiceProvider, Transient, TypeList, createClassMarker, createToken, optionsToken, type Guid, type IOptions, type IServiceProvider } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpUnitOfWorkOptions, IUnitOfWorkManager } from "@abp/uow";

/** Port of `DataSeedContext`. */
export class DataSeedContext {
  readonly properties = new Map<string, unknown>();

  constructor(public tenantId: Guid | undefined = undefined) {}

  get(name: string): unknown {
    return this.properties.get(name);
  }

  set(name: string, value: unknown): void {
    this.properties.set(name, value);
  }

  withProperty(key: string, value: unknown): this {
    this.properties.set(key, value);
    return this;
  }
}

/** Port of `IDataSeedContributor`. Mark implementations with `@DataSeedContributor()` for auto registration. */
export interface IDataSeedContributor {
  seed(context: DataSeedContext): Promise<void>;
}
export const DataSeedContributor = createClassMarker("IDataSeedContributor");

/** Port of `DataSeedContributorList`. */
export class DataSeedContributorList extends TypeList<IDataSeedContributor> {}

/** Port of `AbpDataSeedOptions`. */
export class AbpDataSeedOptions {
  readonly contributors = new DataSeedContributorList();
}

/** Port of `IDataSeeder`. */
export interface IDataSeeder {
  seed(context?: DataSeedContext | Guid): Promise<void>;
}
export const IDataSeeder = createToken<IDataSeeder>("IDataSeeder");

/** Port of `DataSeederExtensions` property names. */
export const DataSeederProperties = {
  SeedInSeparateUow: "__SeedInSeparateUow",
  SeedInSeparateUowOptions: "__SeedInSeparateUowOptions",
  SeedInSeparateUowRequiresNew: "__SeedInSeparateUowRequiresNew",
} as const;

/** Port of `DataSeederExtensions.SeedInSeparateUowAsync`: one unit of work per contributor. */
export function seedInSeparateUow(seeder: IDataSeeder, tenantId?: Guid, options?: AbpUnitOfWorkOptions, requiresNew = false): Promise<void> {
  const context = new DataSeedContext(tenantId);
  context.withProperty(DataSeederProperties.SeedInSeparateUow, true);
  context.withProperty(DataSeederProperties.SeedInSeparateUowOptions, options);
  context.withProperty(DataSeederProperties.SeedInSeparateUowRequiresNew, requiresNew);
  return seeder.seed(context);
}

/**
 * Port of `DataSeeder`. Contributors run inside a service scope, under `ICurrentTenant.change(context.tenantId)`
 * and in a new unit of work (`requiresNew`), the equivalent of the `[UnitOfWork]` on `SeedAsync` in .NET.
 */
@Transient(IDataSeeder)
export class DataSeeder implements IDataSeeder {
  static readonly inject = [optionsToken(AbpDataSeedOptions), IRootServiceProvider, ICurrentTenant] as const;
  protected readonly options: AbpDataSeedOptions;

  constructor(
    options: IOptions<AbpDataSeedOptions>,
    protected readonly rootServiceProvider: IServiceProvider,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    this.options = options.value;
  }

  async seed(contextOrTenantId?: DataSeedContext | Guid): Promise<void> {
    const context = contextOrTenantId instanceof DataSeedContext ? contextOrTenantId : new DataSeedContext(contextOrTenantId);
    await this.currentTenant.run(context.tenantId, undefined, async () => {
      const scope = this.rootServiceProvider.createScope();
      try {
        const manager = scope.serviceProvider.getRequired(IUnitOfWorkManager);
        if (context.properties.has(DataSeederProperties.SeedInSeparateUow)) {
          const uowOptions = context.get(DataSeederProperties.SeedInSeparateUowOptions);
          const options = uowOptions instanceof AbpUnitOfWorkOptions ? uowOptions : new AbpUnitOfWorkOptions();
          const requiresNew = context.get(DataSeederProperties.SeedInSeparateUowRequiresNew) === true;
          for (const contributorType of this.options.contributors) {
            await this.runInUnitOfWork(manager, options, requiresNew, () => scope.serviceProvider.getRequired(contributorType).seed(context));
          }
          return;
        }

        await this.runInUnitOfWork(manager, new AbpUnitOfWorkOptions(), true, async () => {
          for (const contributorType of this.options.contributors) await scope.serviceProvider.getRequired(contributorType).seed(context);
        });
      } finally {
        await scope.dispose();
      }
    });
  }

  private async runInUnitOfWork(manager: IUnitOfWorkManager, options: AbpUnitOfWorkOptions, requiresNew: boolean, action: () => Promise<void>): Promise<void> {
    const uow = manager.begin(options, requiresNew);
    try {
      await action();
      await uow.complete();
    } finally {
      await uow.dispose();
    }
  }
}
