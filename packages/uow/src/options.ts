import { AbpException } from "@abp/core";

/** Port of `System.Data.IsolationLevel`. */
export enum IsolationLevel {
  Unspecified = -1,
  Chaos = 16,
  ReadUncommitted = 256,
  ReadCommitted = 4096,
  RepeatableRead = 65536,
  Serializable = 1048576,
  Snapshot = 16777216,
}

/** Port of `UnitOfWorkTransactionBehavior`. */
export enum UnitOfWorkTransactionBehavior {
  Auto = "Auto",
  Enabled = "Enabled",
  Disabled = "Disabled",
}

/** Port of `IAbpUnitOfWorkOptions`. */
export interface IAbpUnitOfWorkOptions {
  readonly isTransactional: boolean;
  readonly isolationLevel: IsolationLevel | undefined;
  /** Milliseconds. */
  readonly timeout: number | undefined;
}

/** Port of `AbpUnitOfWorkOptions`. */
export class AbpUnitOfWorkOptions implements IAbpUnitOfWorkOptions {
  isTransactional: boolean;
  isolationLevel: IsolationLevel | undefined;
  timeout: number | undefined;

  constructor(init: Partial<IAbpUnitOfWorkOptions> = {}) {
    this.isTransactional = init.isTransactional ?? false;
    this.isolationLevel = init.isolationLevel;
    this.timeout = init.timeout;
  }

  clone(): AbpUnitOfWorkOptions {
    return new AbpUnitOfWorkOptions(this);
  }
}

/** Port of `AbpUnitOfWorkDefaultOptions` (global defaults). */
export class AbpUnitOfWorkDefaultOptions {
  transactionBehavior: UnitOfWorkTransactionBehavior = UnitOfWorkTransactionBehavior.Auto;
  isolationLevel: IsolationLevel | undefined;
  timeout: number | undefined;

  normalize(options: AbpUnitOfWorkOptions): AbpUnitOfWorkOptions {
    if (options.isolationLevel === undefined) options.isolationLevel = this.isolationLevel;
    if (options.timeout === undefined) options.timeout = this.timeout;
    return options;
  }

  calculateIsTransactional(autoValue: boolean): boolean {
    switch (this.transactionBehavior) {
      case UnitOfWorkTransactionBehavior.Enabled:
        return true;
      case UnitOfWorkTransactionBehavior.Disabled:
        return false;
      case UnitOfWorkTransactionBehavior.Auto:
        return autoValue;
      default: {
        const _exhaustive: never = this.transactionBehavior;
        throw new AbpException(`Not implemented TransactionBehavior value: ${String(_exhaustive)}`);
      }
    }
  }
}
