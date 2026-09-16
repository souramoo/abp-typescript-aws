import { Check, type Guid, type IServiceProvider } from "@abp/core";
import type { IDatabaseApi, ITransactionApi } from "./database-api.js";
import type { UnitOfWorkEventRecord } from "./events.js";
import type { AbpUnitOfWorkOptions, IAbpUnitOfWorkOptions } from "./options.js";
import { decrementActiveChildUnitOfWorkCount, incrementActiveChildUnitOfWorkCount, type IUnitOfWork, type UnitOfWorkEventArgs, type UnitOfWorkEventReplacementSelector, type UnitOfWorkFailedEventArgs } from "./unit-of-work.js";

/** Port of `ChildUnitOfWork`: a scope over an existing (ambient) unit of work; `complete()` is a no-op. */
export class ChildUnitOfWork implements IUnitOfWork {
  private disposed = false;

  constructor(private readonly parent: IUnitOfWork) {
    Check.notNull(parent, "parent");
    incrementActiveChildUnitOfWorkCount(parent);
  }

  get id(): Guid {
    return this.parent.id;
  }
  get items(): Map<string, unknown> {
    return this.parent.items;
  }
  get options(): IAbpUnitOfWorkOptions {
    return this.parent.options;
  }
  get outer(): IUnitOfWork | undefined {
    return this.parent.outer;
  }
  get isReserved(): boolean {
    return this.parent.isReserved;
  }
  get isDisposed(): boolean {
    return this.parent.isDisposed;
  }
  get isCompleted(): boolean {
    return this.parent.isCompleted;
  }
  get reservationName(): string | undefined {
    return this.parent.reservationName;
  }
  get serviceProvider(): IServiceProvider {
    return this.parent.serviceProvider;
  }

  setOuter(outer: IUnitOfWork | undefined): void {
    this.parent.setOuter(outer);
  }
  initialize(options: AbpUnitOfWorkOptions): void {
    this.parent.initialize(options);
  }
  reserve(reservationName: string): void {
    this.parent.reserve(reservationName);
  }
  saveChanges(): Promise<void> {
    return this.parent.saveChanges();
  }
  async complete(): Promise<void> {}
  rollback(): Promise<void> {
    return this.parent.rollback();
  }
  onCompleted(handler: () => void | Promise<void>): void {
    this.parent.onCompleted(handler);
  }
  onFailed(handler: (args: UnitOfWorkFailedEventArgs) => void | Promise<void>): void {
    this.parent.onFailed(handler);
  }
  onDisposed(handler: (args: UnitOfWorkEventArgs) => void | Promise<void>): void {
    this.parent.onDisposed(handler);
  }
  addOrReplaceLocalEvent(eventRecord: UnitOfWorkEventRecord, replacementSelector?: UnitOfWorkEventReplacementSelector): void {
    this.parent.addOrReplaceLocalEvent(eventRecord, replacementSelector);
  }
  addOrReplaceDistributedEvent(eventRecord: UnitOfWorkEventRecord, replacementSelector?: UnitOfWorkEventReplacementSelector): void {
    this.parent.addOrReplaceDistributedEvent(eventRecord, replacementSelector);
  }
  findDatabaseApi(key: string): IDatabaseApi | undefined {
    return this.parent.findDatabaseApi(key);
  }
  addDatabaseApi(key: string, api: IDatabaseApi): void {
    this.parent.addDatabaseApi(key, api);
  }
  getOrAddDatabaseApi<T extends IDatabaseApi>(key: string, factory: () => T | Promise<T>): Promise<T> {
    return this.parent.getOrAddDatabaseApi(key, factory);
  }
  findTransactionApi(key: string): ITransactionApi | undefined {
    return this.parent.findTransactionApi(key);
  }
  addTransactionApi(key: string, api: ITransactionApi): void {
    this.parent.addTransactionApi(key, api);
  }
  getOrAddTransactionApi<T extends ITransactionApi>(key: string, factory: () => T | Promise<T>): Promise<T> {
    return this.parent.getOrAddTransactionApi(key, factory);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    decrementActiveChildUnitOfWorkCount(this.parent);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  toString(): string {
    return `[UnitOfWork ${this.id}]`;
  }
}
