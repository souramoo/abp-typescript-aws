import { AbpException, type AbstractClass, type Class, type ServiceCollection } from "@abp/core";
import { getConnectionStringName } from "@abp/data";
import { AbpCommonDbContextRegistrationOptions, BasicAggregateRoot, BasicAggregateRootBase, RepositoryRegistrarBase, type AnyRepository } from "@abp/ddd-domain";
import { AbpDistributedEventBusOptions, eventInboxToken, eventOutboxToken, type InboxConfig, type OutboxConfig } from "@abp/event-bus";
import { DynamoDbContextModelSource, type AbpDynamoDbContext } from "./abp-dynamodb-context.js";
import { dynamoDbEventInboxClassFor, dynamoDbEventOutboxClassFor } from "./dynamodb-event-boxes.js";
import { dynamoDbRepositoryClassFor } from "./dynamodb-repository.js";

/** Port of `AbpMongoDbContextRegistrationOptions` / `IAbpMongoDbContextRegistrationOptionsBuilder`. */
export class AbpDynamoDbContextRegistrationOptions extends AbpCommonDbContextRegistrationOptions {
  readonly replacedDbContextTypes = new Map<AbstractClass, Class<AbpDynamoDbContext> | undefined>();
  outboxEnabled = false;
  inboxEnabled = false;

  constructor(originalDbContextType: Class<AbpDynamoDbContext>, services: ServiceCollection) {
    super(originalDbContextType, services);
  }

  /** Port of `ReplaceDbContext`: resolving `otherDbContextType` yields this (or the target) context. */
  replaceDbContext(otherDbContextType: AbstractClass, targetDbContextType?: Class<AbpDynamoDbContext>): this {
    if (!(this.originalDbContextType.prototype instanceof otherDbContextType) && this.originalDbContextType !== otherDbContextType) {
      throw new AbpException(`${this.originalDbContextType.name} should inherit/implement ${otherDbContextType.name}!`);
    }
    this.replacedDbContextTypes.set(otherDbContextType, targetDbContextType);
    return this;
  }

  /** Stores the distributed event outbox in this context's table and configures the outbox named after the context. */
  addOutbox(): this {
    this.outboxEnabled = true;
    return this;
  }

  /** Stores the distributed event inbox in this context's table and configures the inbox named after the context. */
  addInbox(): this {
    this.inboxEnabled = true;
    return this;
  }
}

/** Port of `MongoDbRepositoryRegistrar`. */
export class DynamoDbRepositoryRegistrar extends RepositoryRegistrarBase<AbpDynamoDbContextRegistrationOptions> {
  constructor(options: AbpDynamoDbContextRegistrationOptions) {
    super(options);
  }

  protected getEntityTypes(dbContextType: AbstractClass): readonly AbstractClass[] {
    return DynamoDbContextModelSource.getModel(dbContextType as Class<AbpDynamoDbContext>).entityTypes;
  }

  protected getRepositoryType(dbContextType: AbstractClass, entityType: AbstractClass): Class<AnyRepository> {
    return dynamoDbRepositoryClassFor(dbContextType as Class<AbpDynamoDbContext>, entityType as AbstractClass<never>) as unknown as Class<AnyRepository>;
  }

  protected isAggregateRoot(entityType: AbstractClass): boolean {
    const prototype = entityType.prototype as object;
    return prototype instanceof BasicAggregateRoot || prototype instanceof BasicAggregateRootBase || (prototype as { __aggregateRoot?: unknown }).__aggregateRoot === true;
  }
}

/** Port of `MongoDbOutboxConfigExtensions.UseMongoDbContext`. */
export function useDynamoDbContextForOutbox(outboxConfig: OutboxConfig, dbContextType: Class<AbpDynamoDbContext>): void {
  const databaseName = getConnectionStringName(dbContextType);
  outboxConfig.databaseName = databaseName;
  outboxConfig.implementationType = eventOutboxToken(databaseName);
}

/** Port of `MongoDbInboxConfigExtensions.UseMongoDbContext`. */
export function useDynamoDbContextForInbox(inboxConfig: InboxConfig, dbContextType: Class<AbpDynamoDbContext>): void {
  const databaseName = getConnectionStringName(dbContextType);
  inboxConfig.databaseName = databaseName;
  inboxConfig.implementationType = eventInboxToken(databaseName);
}

/**
 * Port of `AbpMongoDbServiceCollectionExtensions.AddMongoDbContext`:
 * `addDynamoDbContext(services, MyDbContext, o => o.addDefaultRepositories().addRepository(Book, BookRepository).addOutbox())`.
 */
export function addDynamoDbContext<TDbContext extends AbpDynamoDbContext>(services: ServiceCollection, dbContextType: Class<TDbContext>, optionsBuilder?: (options: AbpDynamoDbContextRegistrationOptions) => void): ServiceCollection {
  const options = new AbpDynamoDbContextRegistrationOptions(dbContextType, services);
  optionsBuilder?.(options);

  services.tryAddTransient(dbContextType);
  if (options.defaultRepositoryDbContextType !== dbContextType) {
    services.tryAddTransient(options.defaultRepositoryDbContextType as Class<AbpDynamoDbContext>, { useFactory: (p) => p.getRequired(dbContextType) });
  }
  for (const [originalDbContextType, targetDbContextType] of options.replacedDbContextTypes) {
    const target = targetDbContextType ?? dbContextType;
    services.replaceTransient(originalDbContextType as Class<AbpDynamoDbContext>, { useFactory: (p) => p.getRequired(target) });
  }

  new DynamoDbRepositoryRegistrar(options).addRepositories();

  const databaseName = getConnectionStringName(dbContextType);
  if (options.outboxEnabled) {
    services.replaceTransient(eventOutboxToken(databaseName), dynamoDbEventOutboxClassFor(dbContextType));
    services.options.configure(AbpDistributedEventBusOptions, (o) => o.outboxes.configure(databaseName, (config) => useDynamoDbContextForOutbox(config, dbContextType)));
  }
  if (options.inboxEnabled) {
    services.replaceTransient(eventInboxToken(databaseName), dynamoDbEventInboxClassFor(dbContextType));
    services.options.configure(AbpDistributedEventBusOptions, (o) => o.inboxes.configure(databaseName, (config) => useDynamoDbContextForInbox(config, dbContextType)));
  }
  return services;
}
