import { AbpException, type AbstractClass, type Class, type IAbpLazyServiceProvider } from "@abp/core";
import type { DynamoDbDatabase } from "./dynamodb-database.js";
import { DynamoDbModelBuilder, type DynamoDbContextModel, type DynamoDbEntityConfiguration } from "./entity-configuration.js";

const models = new WeakMap<object, DynamoDbContextModel>();

/**
 * Port of `IMongoModelSource`/`MongoModelSource`: the entity model of a db-context class, built once per class by
 * running `configureEntities` on a throwaway instance (contexts are constructed without arguments).
 */
export const DynamoDbContextModelSource = {
  getModel(dbContext: AbpDynamoDbContext | Class<AbpDynamoDbContext>): DynamoDbContextModel {
    const dbContextType = typeof dbContext === "function" ? dbContext : (dbContext.constructor as Class<AbpDynamoDbContext>);
    let model = models.get(dbContextType);
    if (!model) {
      const instance = typeof dbContext === "function" ? new dbContext() : dbContext;
      const builder = new DynamoDbModelBuilder();
      instance["configureEntities"](builder);
      model = builder.build();
      models.set(dbContextType, model);
    }
    return model;
  },
};

/**
 * Port of `AbpMongoDbContext`. Declare the owned entities in `configureEntities`; use `@ConnectionStringName("...")`
 * from `@abp/data` to pick the table (`ConnectionStrings:<Name>`), otherwise `ConnectionStrings:Default` is used.
 * A context is transient and bound to the table session of the current unit of work by `initializeDatabase`.
 */
export abstract class AbpDynamoDbContext {
  lazyServiceProvider!: IAbpLazyServiceProvider;
  private currentDatabase: DynamoDbDatabase | undefined;

  /** Port of `CreateModel(IMongoModelBuilder)`. */
  protected configureEntities(_builder: DynamoDbModelBuilder): void {}

  get model(): DynamoDbContextModel {
    return DynamoDbContextModelSource.getModel(this);
  }

  get entities(): readonly DynamoDbEntityConfiguration[] {
    return [...this.model.entities.values()];
  }

  getEntityTypes(): readonly AbstractClass[] {
    return this.model.entityTypes;
  }

  getEntityConfiguration<TEntity extends object>(entityType: AbstractClass<TEntity>): DynamoDbEntityConfiguration<TEntity> {
    return this.model.getConfiguration(entityType);
  }

  get isInitialized(): boolean {
    return this.currentDatabase !== undefined;
  }

  /** The table session of the unit of work (port of `Database` + `SessionHandle`). */
  get database(): DynamoDbDatabase {
    if (!this.currentDatabase) throw new AbpException(`${this.constructor.name} has not been initialized. Resolve it through IDynamoDbContextProvider inside a unit of work.`);
    return this.currentDatabase;
  }

  get tableName(): string {
    return this.database.tableName;
  }

  /** Port of `InitializeDatabase(database, client, sessionHandle)`. */
  initializeDatabase(database: DynamoDbDatabase): void {
    this.currentDatabase = database;
  }
}
