import { Check, DisposeAction, ILoggerFactory, Transient, createToken, optionsToken, type Class, type ILogger, type IOptions } from "@abp/core";
import type { EntityChangeType} from "@abp/auditing";
import { NamedTypeSelector } from "@abp/auditing";
import { EventOrderGenerator, IUnitOfWorkManager, UnitOfWorkEventRecord, type IUnitOfWork } from "@abp/uow";
import { entityEquals, isEntity, type IEntityBase } from "../entity.js";
import { EntityCreatedEventData, EntityDeletedEventData, EntityUpdatedEventData, type EntityEventClass } from "./entity-event-data.js";
import { AbpDistributedEntityEventOptions, EntityCreatedEto, EntityDeletedEto, EntityUpdatedEto, type EntityEtoEventClass } from "./distributed/etos.js";

type OpenEntityEventType = typeof EntityCreatedEventData | typeof EntityUpdatedEventData | typeof EntityDeletedEventData;
type OpenEtoEventType = typeof EntityCreatedEto | typeof EntityUpdatedEto | typeof EntityDeletedEto;
import { IEntityToEtoMapper } from "./distributed/entity-to-eto-mapper.js";

/** Port of `DomainEventEntry`. */
export class DomainEventEntry {
  constructor(
    readonly sourceEntity: object,
    readonly eventData: object,
    readonly eventOrder: number,
  ) {}
}

/** Port of `EntityChangeEntry`. */
export class EntityChangeEntry {
  constructor(
    public entity: object,
    public changeType: EntityChangeType,
  ) {}
}

/** Port of `EntityEventReport`. */
export class EntityEventReport {
  readonly domainEvents: DomainEventEntry[] = [];
  readonly distributedEvents: DomainEventEntry[] = [];

  toString(): string {
    return `[EntityEventReport] DomainEvents: ${this.domainEvents.length}, DistributedEvents: ${this.distributedEvents.length}`;
  }
}

/** Port of `IEntitySelectorList` / `EntitySelectorList`. */
export class EntitySelectorList extends Array<NamedTypeSelector> {
  add(name: string, predicate: (type: Class) => boolean): this {
    this.push(new NamedTypeSelector(name, predicate));
    return this;
  }
  isMatch(entityType: Class): boolean {
    return this.some((s) => s.predicate(entityType));
  }
}

/** Port of `AbpEntityChangeOptions`. */
export class AbpEntityChangeOptions {
  /** Default: true. Publish the EntityUpdatedEvent when any navigation property changes. */
  publishEntityUpdatedEventWhenNavigationChanges = true;
  ignoredNavigationEntitySelectors = new EntitySelectorList();
  /** Default: true. Update the aggregate root (concurrency stamp, modification audit) when any navigation property changes. */
  updateAggregateRootWhenNavigationChanges = true;
  ignoredUpdateAggregateRootSelectors = new EntitySelectorList();
}

/* Port of `EntityChangeUnitOfWorkExtensions`. */
const UpdateAggregateRootWhenNavigationChangesItemKey = "Abp.UpdateAggregateRootWhenNavigationChanges";

export function getUpdateAggregateRootWhenNavigationChangesOrNull(unitOfWork: IUnitOfWork): boolean | undefined {
  Check.notNull(unitOfWork, "unitOfWork");
  const value = unitOfWork.items.get(UpdateAggregateRootWhenNavigationChangesItemKey);
  return typeof value === "boolean" ? value : undefined;
}

export function disableUpdateAggregateRootWhenNavigationChanges(unitOfWork: IUnitOfWork): Disposable {
  return setUpdateAggregateRootWhenNavigationChanges(unitOfWork, false);
}

export function enableUpdateAggregateRootWhenNavigationChanges(unitOfWork: IUnitOfWork): Disposable {
  return setUpdateAggregateRootWhenNavigationChanges(unitOfWork, true);
}

function setUpdateAggregateRootWhenNavigationChanges(unitOfWork: IUnitOfWork, value: boolean): Disposable {
  const previousValue = getUpdateAggregateRootWhenNavigationChangesOrNull(unitOfWork);
  unitOfWork.items.set(UpdateAggregateRootWhenNavigationChangesItemKey, value);
  return new DisposeAction(() => {
    if (previousValue === undefined) unitOfWork.items.delete(UpdateAggregateRootWhenNavigationChangesItemKey);
    else unitOfWork.items.set(UpdateAggregateRootWhenNavigationChangesItemKey, previousValue);
  });
}

/** Port of `IEntityChangeEventHelper`: queues entity change events into the current unit of work. */
export interface IEntityChangeEventHelper {
  publishEntityCreatedEvent(entity: object): void;
  publishEntityUpdatedEvent(entity: object): void;
  publishEntityDeletedEvent(entity: object): void;
}
export const IEntityChangeEventHelper = createToken<IEntityChangeEventHelper>("IEntityChangeEventHelper");

/** Port of `NullEntityChangeEventHelper`. */
export class NullEntityChangeEventHelper implements IEntityChangeEventHelper {
  static readonly instance = new NullEntityChangeEventHelper();
  publishEntityCreatedEvent(): void {}
  publishEntityUpdatedEvent(): void {}
  publishEntityDeletedEvent(): void {}
}

const UnitOfWorkEventRecordEntityPropName = "_Abp_Entity";

/**
 * Port of `EntityChangeEventHelper`. Events are added to the current unit of work with a replacement selector so
 * several changes of the same entity in one unit of work publish a single event per event type.
 */
@Transient(IEntityChangeEventHelper)
export class EntityChangeEventHelper implements IEntityChangeEventHelper {
  static readonly inject = [IUnitOfWorkManager, IEntityToEtoMapper, optionsToken(AbpDistributedEntityEventOptions), ILoggerFactory] as const;
  protected readonly distributedEntityEventOptions: AbpDistributedEntityEventOptions;
  protected readonly logger: ILogger;

  constructor(
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    protected readonly entityToEtoMapper: IEntityToEtoMapper,
    distributedEntityEventOptions: IOptions<AbpDistributedEntityEventOptions>,
    loggerFactory: ILoggerFactory,
  ) {
    this.distributedEntityEventOptions = distributedEntityEventOptions.value;
    this.logger = loggerFactory.createLogger(EntityChangeEventHelper.name);
  }

  publishEntityCreatedEvent(entity: object): void {
    this.publish(entity, EntityCreatedEventData, EntityCreatedEto);
  }

  publishEntityUpdatedEvent(entity: object): void {
    this.publish(entity, EntityUpdatedEventData, EntityUpdatedEto);
  }

  publishEntityDeletedEvent(entity: object): void {
    this.publish(entity, EntityDeletedEventData, EntityDeletedEto);
  }

  private publish(entity: object, localEventType: OpenEntityEventType, etoEventType: OpenEtoEventType): void {
    const entityType = entity.constructor as Class;
    this.triggerEventWithEntity("local", localEventType.of(entityType), entity, entity);

    if (!this.shouldPublishDistributedEventForEntity(entity)) return;
    const eto = this.entityToEtoMapper.map(entity);
    if (eto !== undefined) this.triggerEventWithEntity("distributed", etoEventType.of(eto.constructor as Class), eto, entity);
  }

  protected shouldPublishDistributedEventForEntity(entity: object): boolean {
    const entityType = entity.constructor as Class;
    return !this.distributedEntityEventOptions.ignoredEventSelectors.isMatch(entityType) && this.distributedEntityEventOptions.autoEventSelectors.isMatch(entityType);
  }

  protected triggerEventWithEntity(bus: "local" | "distributed", eventType: EntityEventClass | EntityEtoEventClass, entityOrEto: object, originalEntity: object): void {
    const eventData = new eventType(entityOrEto);
    const currentUow = this.unitOfWorkManager.current;
    if (!currentUow) {
      this.logger.warn("UnitOfWorkManager.current is undefined! Can not publish the event.");
      return;
    }

    const eventRecord = new UnitOfWorkEventRecord(eventType, eventData, EventOrderGenerator.getNext());
    eventRecord.properties.set(UnitOfWorkEventRecordEntityPropName, originalEntity);

    if (bus === "distributed") currentUow.addOrReplaceDistributedEvent(eventRecord, (otherRecord) => this.isSameEntityEventRecord(eventRecord, otherRecord));
    else currentUow.addOrReplaceLocalEvent(eventRecord, (otherRecord) => this.isSameEntityEventRecord(eventRecord, otherRecord));
  }

  isSameEntityEventRecord(record1: UnitOfWorkEventRecord, record2: UnitOfWorkEventRecord): boolean {
    if (record1.eventType !== record2.eventType) return false;
    const entity1 = record1.properties.get(UnitOfWorkEventRecordEntityPropName);
    const entity2 = record2.properties.get(UnitOfWorkEventRecordEntityPropName);
    if (!isEntity(entity1) || !isEntity(entity2)) return false;
    return entityEquals(entity1 as IEntityBase, entity2 as IEntityBase);
  }
}
