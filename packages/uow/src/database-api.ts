import type { IServiceProviderAccessor } from "@abp/core";

/**
 * Port of `IDatabaseApi`: a marker for the per-UoW database session objects (DbContext, DynamoDB client wrapper, …).
 * Empty in .NET; any object qualifies here.
 */
export type IDatabaseApi = object;

/** Port of `ITransactionApi`. */
export interface ITransactionApi {
  commit(): Promise<void>;
  dispose(): void | Promise<void>;
}

/** Port of `ISupportsSavingChanges`. */
export interface ISupportsSavingChanges {
  saveChanges(): Promise<void>;
}

/** Port of `ISupportsRollback`. */
export interface ISupportsRollback {
  rollback(): Promise<void>;
}

export function supportsSavingChanges(api: object): api is ISupportsSavingChanges {
  return typeof (api as ISupportsSavingChanges).saveChanges === "function";
}

export function supportsRollback(api: object): api is ISupportsRollback {
  return typeof (api as ISupportsRollback).rollback === "function";
}

/** Port of `IDatabaseApiContainer`. Factories may be async (database sessions often open connections). */
export interface IDatabaseApiContainer extends IServiceProviderAccessor {
  findDatabaseApi(key: string): IDatabaseApi | undefined;
  addDatabaseApi(key: string, api: IDatabaseApi): void;
  getOrAddDatabaseApi<T extends IDatabaseApi>(key: string, factory: () => T | Promise<T>): Promise<T>;
}

/** Port of `ITransactionApiContainer`. */
export interface ITransactionApiContainer {
  findTransactionApi(key: string): ITransactionApi | undefined;
  addTransactionApi(key: string, api: ITransactionApi): void;
  getOrAddTransactionApi<T extends ITransactionApi>(key: string, factory: () => T | Promise<T>): Promise<T>;
}
