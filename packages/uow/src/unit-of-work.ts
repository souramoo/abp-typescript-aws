import { AbpException, Check, Guid, IServiceProviderToken, Transient, createToken, optionsToken, type IOptions, type IServiceProvider } from "@abp/core";
import { type IDatabaseApi, type IDatabaseApiContainer, type ITransactionApi, type ITransactionApiContainer, supportsRollback, supportsSavingChanges } from "./database-api.js";
import { IUnitOfWorkEventPublisher, type UnitOfWorkEventRecord } from "./events.js";
import { AbpUnitOfWorkDefaultOptions, AbpUnitOfWorkOptions, type IAbpUnitOfWorkOptions } from "./options.js";

/** Port of `UnitOfWorkEventArgs`. */
export class UnitOfWorkEventArgs {
  constructor(readonly unitOfWork: IUnitOfWork) {}
}

/** Port of `UnitOfWorkFailedEventArgs`. */
export class UnitOfWorkFailedEventArgs extends UnitOfWorkEventArgs {
  constructor(
    unitOfWork: IUnitOfWork,
    /** Set only if an error occurred during `complete()`. */
    readonly exception: unknown,
    /** True if the unit of work was manually rolled back. */
    readonly isRolledback: boolean,
  ) {
    super(unitOfWork);
  }
}

export type UnitOfWorkEventReplacementSelector = (record: UnitOfWorkEventRecord) => boolean;

/**
 * Port of `IUnitOfWork`. The .NET `Failed`/`Disposed` events are `onFailed`/`onDisposed` handlers;
 * `dispose()` is async and rolls back uncommitted work because database/transaction APIs are async here.
 */
export interface IUnitOfWork extends IDatabaseApiContainer, ITransactionApiContainer, AsyncDisposable {
  readonly id: Guid;
  readonly items: Map<string, unknown>;
  readonly options: IAbpUnitOfWorkOptions;
  readonly outer: IUnitOfWork | undefined;
  readonly isReserved: boolean;
  readonly isDisposed: boolean;
  readonly isCompleted: boolean;
  readonly reservationName: string | undefined;
  setOuter(outer: IUnitOfWork | undefined): void;
  initialize(options: AbpUnitOfWorkOptions): void;
  reserve(reservationName: string): void;
  saveChanges(): Promise<void>;
  complete(): Promise<void>;
  rollback(): Promise<void>;
  onCompleted(handler: () => void | Promise<void>): void;
  onFailed(handler: (args: UnitOfWorkFailedEventArgs) => void | Promise<void>): void;
  onDisposed(handler: (args: UnitOfWorkEventArgs) => void | Promise<void>): void;
  addOrReplaceLocalEvent(eventRecord: UnitOfWorkEventRecord, replacementSelector?: UnitOfWorkEventReplacementSelector): void;
  addOrReplaceDistributedEvent(eventRecord: UnitOfWorkEventRecord, replacementSelector?: UnitOfWorkEventReplacementSelector): void;
  dispose(): Promise<void>;
}
export const IUnitOfWork = createToken<IUnitOfWork>("IUnitOfWork");

/** Port of `UnitOfWork.UnitOfWorkReservationName`. */
export const UnitOfWorkReservationName = "_AbpActionUnitOfWork";

interface EventWithPredicate {
  readonly record: UnitOfWorkEventRecord;
  readonly replacementSelector: UnitOfWorkEventReplacementSelector | undefined;
}

/**
 * Port of the `UnitOfWork` class. Named `DefaultUnitOfWork` because `UnitOfWork` is the
 * `[UnitOfWork]` attribute decorator in this port.
 */
@Transient(IUnitOfWork)
export class DefaultUnitOfWork implements IUnitOfWork {
  static readonly inject = [IServiceProviderToken, IUnitOfWorkEventPublisher, optionsToken(AbpUnitOfWorkDefaultOptions)] as const;
  static readonly UnitOfWorkReservationName = UnitOfWorkReservationName;

  readonly id: Guid = Guid.newGuid();
  readonly items = new Map<string, unknown>();
  private currentOptions: AbpUnitOfWorkOptions | undefined;
  private outerUow: IUnitOfWork | undefined;
  private reserved = false;
  private disposed = false;
  private completed = false;
  private reservation: string | undefined;

  protected readonly completedHandlers: (() => void | Promise<void>)[] = [];
  protected readonly failedHandlers: ((args: UnitOfWorkFailedEventArgs) => void | Promise<void>)[] = [];
  protected readonly disposedHandlers: ((args: UnitOfWorkEventArgs) => void | Promise<void>)[] = [];
  protected readonly localEventWithPredicates: EventWithPredicate[] = [];
  protected readonly localEvents: UnitOfWorkEventRecord[] = [];
  protected readonly distributedEventWithPredicates: EventWithPredicate[] = [];
  protected readonly distributedEvents: UnitOfWorkEventRecord[] = [];

  private readonly databaseApis = new Map<string, IDatabaseApi>();
  private readonly pendingDatabaseApis = new Map<string, Promise<IDatabaseApi>>();
  private readonly transactionApis = new Map<string, ITransactionApi>();
  private readonly pendingTransactionApis = new Map<string, Promise<ITransactionApi>>();
  private readonly defaultOptions: AbpUnitOfWorkDefaultOptions;

  private exception: unknown;
  private isCompleting = false;
  private isRolledback = false;

  constructor(
    readonly serviceProvider: IServiceProvider,
    protected readonly unitOfWorkEventPublisher: IUnitOfWorkEventPublisher,
    defaultOptions: IOptions<AbpUnitOfWorkDefaultOptions>,
  ) {
    this.defaultOptions = defaultOptions.value;
  }

  get options(): IAbpUnitOfWorkOptions {
    return this.currentOptions ?? new AbpUnitOfWorkOptions();
  }
  get outer(): IUnitOfWork | undefined {
    return this.outerUow;
  }
  get isReserved(): boolean {
    return this.reserved;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  get isCompleted(): boolean {
    return this.completed;
  }
  get reservationName(): string | undefined {
    return this.reservation;
  }

  initialize(options: AbpUnitOfWorkOptions): void {
    Check.notNull(options, "options");
    if (this.currentOptions) throw new AbpException("This unit of work has already been initialized.");
    this.currentOptions = this.defaultOptions.normalize(options.clone());
    this.reserved = false;
  }

  reserve(reservationName: string): void {
    Check.notNullOrWhiteSpace(reservationName, "reservationName");
    this.reservation = reservationName;
    this.reserved = true;
  }

  setOuter(outer: IUnitOfWork | undefined): void {
    this.outerUow = outer;
  }

  async saveChanges(): Promise<void> {
    if (this.isRolledback) return;
    for (const databaseApi of this.getAllActiveDatabaseApis()) {
      if (supportsSavingChanges(databaseApi)) await databaseApi.saveChanges();
    }
  }

  getAllActiveDatabaseApis(): readonly IDatabaseApi[] {
    return [...this.databaseApis.values()];
  }

  getAllActiveTransactionApis(): readonly ITransactionApi[] {
    return [...this.transactionApis.values()];
  }

  async complete(): Promise<void> {
    if (this.isRolledback) return;
    this.preventMultipleComplete();
    try {
      this.isCompleting = true;
      await this.saveChanges();
      this.collectEvents();

      while (this.localEvents.length > 0 || this.distributedEvents.length > 0) {
        if (this.localEvents.length > 0) {
          const localEventsToBePublished = this.localEvents.splice(0).sort((a, b) => a.eventOrder - b.eventOrder);
          await this.unitOfWorkEventPublisher.publishLocalEvents(localEventsToBePublished);
        }
        if (this.distributedEvents.length > 0) {
          const distributedEventsToBePublished = this.distributedEvents.splice(0).sort((a, b) => a.eventOrder - b.eventOrder);
          await this.unitOfWorkEventPublisher.publishDistributedEvents(distributedEventsToBePublished);
        }
        await this.saveChanges();
        this.collectEvents();
      }

      await this.commitTransactions();
      this.completed = true;
      await this.onCompletedAsync();
    } catch (e) {
      this.exception = e;
      throw e;
    }
  }

  async rollback(): Promise<void> {
    if (this.isRolledback) return;
    this.isRolledback = true;
    await this.rollbackAll();
  }

  findDatabaseApi(key: string): IDatabaseApi | undefined {
    return this.databaseApis.get(key);
  }

  addDatabaseApi(key: string, api: IDatabaseApi): void {
    Check.notNullOrWhiteSpace(key, "key");
    Check.notNull(api, "api");
    if (this.databaseApis.has(key)) throw new AbpException("This unit of work already contains a database API for the given key.");
    this.databaseApis.set(key, api);
  }

  getOrAddDatabaseApi<T extends IDatabaseApi>(key: string, factory: () => T | Promise<T>): Promise<T> {
    Check.notNullOrWhiteSpace(key, "key");
    Check.notNull(factory, "factory");
    return getOrAddAsync(this.databaseApis, this.pendingDatabaseApis, key, factory);
  }

  findTransactionApi(key: string): ITransactionApi | undefined {
    Check.notNullOrWhiteSpace(key, "key");
    return this.transactionApis.get(key);
  }

  addTransactionApi(key: string, api: ITransactionApi): void {
    Check.notNullOrWhiteSpace(key, "key");
    Check.notNull(api, "api");
    if (this.transactionApis.has(key)) throw new AbpException("This unit of work already contains a transaction API for the given key.");
    this.transactionApis.set(key, api);
  }

  getOrAddTransactionApi<T extends ITransactionApi>(key: string, factory: () => T | Promise<T>): Promise<T> {
    Check.notNullOrWhiteSpace(key, "key");
    Check.notNull(factory, "factory");
    return getOrAddAsync(this.transactionApis, this.pendingTransactionApis, key, factory);
  }

  onCompleted(handler: () => void | Promise<void>): void {
    this.completedHandlers.push(handler);
  }

  onFailed(handler: (args: UnitOfWorkFailedEventArgs) => void | Promise<void>): void {
    this.failedHandlers.push(handler);
  }

  onDisposed(handler: (args: UnitOfWorkEventArgs) => void | Promise<void>): void {
    this.disposedHandlers.push(handler);
  }

  addOrReplaceLocalEvent(eventRecord: UnitOfWorkEventRecord, replacementSelector?: UnitOfWorkEventReplacementSelector): void {
    this.localEventWithPredicates.push({ record: eventRecord, replacementSelector });
  }

  addOrReplaceDistributedEvent(eventRecord: UnitOfWorkEventRecord, replacementSelector?: UnitOfWorkEventReplacementSelector): void {
    this.distributedEventWithPredicates.push({ record: eventRecord, replacementSelector });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (!this.completed && !this.isRolledback) await this.rollbackAll();
    await this.disposeTransactions();

    if (!this.completed || this.exception !== undefined) await this.onFailedAsync();
    await this.onDisposedAsync();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  toString(): string {
    return `[UnitOfWork ${this.id}]`;
  }

  protected getEventsRecords(eventWithPredicates: EventWithPredicate[]): UnitOfWorkEventRecord[] {
    const eventRecords: UnitOfWorkEventRecord[] = [];
    for (const { record, replacementSelector } of eventWithPredicates) {
      if (!replacementSelector) {
        eventRecords.push(record);
        continue;
      }
      const foundIndex = eventRecords.findIndex(replacementSelector);
      if (foundIndex < 0) {
        eventRecords.push(record);
      } else {
        record.setOrder(eventRecords[foundIndex]!.eventOrder);
        eventRecords[foundIndex] = record;
      }
    }
    return eventRecords;
  }

  private collectEvents(): void {
    this.localEvents.push(...this.getEventsRecords(this.localEventWithPredicates.splice(0)));
    this.distributedEvents.push(...this.getEventsRecords(this.distributedEventWithPredicates.splice(0)));
  }

  protected async onCompletedAsync(): Promise<void> {
    for (const handler of this.completedHandlers) await handler();
  }

  protected async onFailedAsync(): Promise<void> {
    const args = new UnitOfWorkFailedEventArgs(this, this.exception, this.isRolledback);
    for (const handler of this.failedHandlers) await invokeSafely(() => handler(args));
  }

  protected async onDisposedAsync(): Promise<void> {
    const args = new UnitOfWorkEventArgs(this);
    for (const handler of this.disposedHandlers) await invokeSafely(() => handler(args));
  }

  private async disposeTransactions(): Promise<void> {
    for (const transactionApi of this.getAllActiveTransactionApis()) await invokeSafely(() => transactionApi.dispose());
  }

  private preventMultipleComplete(): void {
    if (this.completed || this.isCompleting) throw new AbpException("Completion has already been requested for this unit of work.");
  }

  protected async rollbackAll(): Promise<void> {
    for (const databaseApi of this.getAllActiveDatabaseApis()) {
      if (supportsRollback(databaseApi)) await invokeSafely(() => databaseApi.rollback());
    }
    for (const transactionApi of this.getAllActiveTransactionApis()) {
      if (supportsRollback(transactionApi)) await invokeSafely(() => transactionApi.rollback());
    }
  }

  protected async commitTransactions(): Promise<void> {
    for (const transaction of this.getAllActiveTransactionApis()) await transaction.commit();
  }
}

async function invokeSafely(action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Port of `InvokeSafely` / the swallowing `catch { }` blocks of UnitOfWork.
  }
}

async function getOrAddAsync<TBase extends object, T extends TBase>(store: Map<string, TBase>, pending: Map<string, Promise<TBase>>, key: string, factory: () => T | Promise<T>): Promise<T> {
  const existing = store.get(key);
  if (existing !== undefined) return existing as T;
  let inFlight = pending.get(key);
  if (!inFlight) {
    inFlight = Promise.resolve()
      .then(factory)
      .then(
        (api) => {
          store.set(key, api);
          pending.delete(key);
          return api;
        },
        (e: unknown) => {
          pending.delete(key);
          throw e;
        },
      );
    pending.set(key, inFlight);
  }
  return (await inFlight) as T;
}

/* Port of `UnitOfWorkExtensions`. */

const ActiveChildUnitOfWorkCountItemKey = "_AbpActiveChildUnitOfWorkCount";

export function isReservedFor(unitOfWork: IUnitOfWork, reservationName: string): boolean {
  return unitOfWork.isReserved && unitOfWork.reservationName === reservationName;
}

/** True while a `begin()` scope without `requiresNew` (a child unit of work) is still active over this unit of work. */
export function hasActiveChildUnitOfWorks(unitOfWork: IUnitOfWork): boolean {
  const count = unitOfWork.items.get(ActiveChildUnitOfWorkCountItemKey);
  return typeof count === "number" && count > 0;
}

export function incrementActiveChildUnitOfWorkCount(unitOfWork: IUnitOfWork): void {
  const count = unitOfWork.items.get(ActiveChildUnitOfWorkCountItemKey);
  unitOfWork.items.set(ActiveChildUnitOfWorkCountItemKey, (typeof count === "number" ? count : 0) + 1);
}

export function decrementActiveChildUnitOfWorkCount(unitOfWork: IUnitOfWork): void {
  const count = unitOfWork.items.get(ActiveChildUnitOfWorkCountItemKey);
  unitOfWork.items.set(ActiveChildUnitOfWorkCountItemKey, Math.max(0, (typeof count === "number" ? count : 0) - 1));
}

export function addItem<T>(unitOfWork: IUnitOfWork, key: string, value: T): void {
  unitOfWork.items.set(key, value);
}

export function getItemOrDefault<T>(unitOfWork: IUnitOfWork, key: string): T | undefined {
  return unitOfWork.items.get(key) as T | undefined;
}

export function getOrAddItem<T>(unitOfWork: IUnitOfWork, key: string, factory: (key: string) => T): T {
  if (!unitOfWork.items.has(key)) unitOfWork.items.set(key, factory(key));
  return unitOfWork.items.get(key) as T;
}

export function removeItem(unitOfWork: IUnitOfWork, key: string): void {
  unitOfWork.items.delete(key);
}
