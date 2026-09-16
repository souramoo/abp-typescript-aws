import { AbpException, Check, DisableConventionalRegistration, IRootServiceProvider, Singleton, createToken, type IServiceProvider } from "@abp/core";
import { IAmbientUnitOfWork } from "./ambient-unit-of-work.js";
import { ChildUnitOfWork } from "./child-unit-of-work.js";
import { AbpUnitOfWorkOptions, type IAbpUnitOfWorkOptions } from "./options.js";
import { IUnitOfWork, isReservedFor } from "./unit-of-work.js";

export type UnitOfWorkOptionsInput = AbpUnitOfWorkOptions | Partial<IAbpUnitOfWorkOptions>;

function toOptions(options: UnitOfWorkOptionsInput | undefined): AbpUnitOfWorkOptions {
  return options instanceof AbpUnitOfWorkOptions ? options : new AbpUnitOfWorkOptions(options);
}

/**
 * Port of `IUnitOfWorkManager` (+ `UnitOfWorkManagerExtensions`: options may be a plain object and default to none).
 * A begun unit of work must be `complete()`d and then `dispose()`d (`try { … complete() } finally { dispose() }`).
 */
export interface IUnitOfWorkManager {
  readonly current: IUnitOfWork | undefined;
  begin(options?: UnitOfWorkOptionsInput, requiresNew?: boolean): IUnitOfWork;
  reserve(reservationName: string, requiresNew?: boolean): IUnitOfWork;
  beginReserved(reservationName: string, options?: UnitOfWorkOptionsInput): void;
  tryBeginReserved(reservationName: string, options?: UnitOfWorkOptionsInput): boolean;
}
export const IUnitOfWorkManager = createToken<IUnitOfWorkManager>("IUnitOfWorkManager");

/** Port of `UnitOfWorkManager`. */
@Singleton(IUnitOfWorkManager)
export class UnitOfWorkManager implements IUnitOfWorkManager {
  static readonly inject = [IAmbientUnitOfWork, IRootServiceProvider] as const;

  constructor(
    private readonly ambientUnitOfWork: IAmbientUnitOfWork,
    private readonly rootServiceProvider: IServiceProvider,
  ) {}

  get current(): IUnitOfWork | undefined {
    return this.ambientUnitOfWork.getCurrentByChecking();
  }

  begin(options?: UnitOfWorkOptionsInput, requiresNew = false): IUnitOfWork {
    const currentUow = this.current;
    if (currentUow && !requiresNew) return new ChildUnitOfWork(currentUow);

    const unitOfWork = this.createNewUnitOfWork();
    unitOfWork.initialize(toOptions(options));
    return unitOfWork;
  }

  reserve(reservationName: string, requiresNew = false): IUnitOfWork {
    Check.notNull(reservationName, "reservationName");
    const ambient = this.ambientUnitOfWork.unitOfWork;
    if (!requiresNew && ambient && isReservedFor(ambient, reservationName)) return new ChildUnitOfWork(ambient);

    const unitOfWork = this.createNewUnitOfWork();
    unitOfWork.reserve(reservationName);
    return unitOfWork;
  }

  beginReserved(reservationName: string, options?: UnitOfWorkOptionsInput): void {
    if (!this.tryBeginReserved(reservationName, options)) {
      throw new AbpException(`Could not find a reserved unit of work with reservation name: ${reservationName}`);
    }
  }

  tryBeginReserved(reservationName: string, options?: UnitOfWorkOptionsInput): boolean {
    Check.notNull(reservationName, "reservationName");
    let uow = this.ambientUnitOfWork.unitOfWork;
    while (uow && !isReservedFor(uow, reservationName)) uow = uow.outer;
    if (!uow) return false;
    uow.initialize(toOptions(options));
    return true;
  }

  private createNewUnitOfWork(): IUnitOfWork {
    const scope = this.rootServiceProvider.createScope();
    try {
      const outerUow = this.ambientUnitOfWork.unitOfWork;
      const unitOfWork = scope.serviceProvider.getRequired(IUnitOfWork);
      unitOfWork.setOuter(outerUow);
      this.ambientUnitOfWork.setUnitOfWork(unitOfWork);
      unitOfWork.onDisposed(async () => {
        this.ambientUnitOfWork.setUnitOfWork(outerUow);
        await scope.dispose();
      });
      return unitOfWork;
    } catch (e) {
      void scope.dispose();
      throw e;
    }
  }
}

/** Port of `AlwaysDisableTransactionsUnitOfWorkManager`; register with `addAlwaysDisableUnitOfWorkTransaction`. */
@DisableConventionalRegistration()
export class AlwaysDisableTransactionsUnitOfWorkManager implements IUnitOfWorkManager {
  static readonly inject = [UnitOfWorkManager] as const;

  constructor(private readonly unitOfWorkManager: UnitOfWorkManager) {}

  get current(): IUnitOfWork | undefined {
    return this.unitOfWorkManager.current;
  }

  begin(options?: UnitOfWorkOptionsInput, requiresNew = false): IUnitOfWork {
    return this.unitOfWorkManager.begin(withoutTransaction(options), requiresNew);
  }

  reserve(reservationName: string, requiresNew = false): IUnitOfWork {
    return this.unitOfWorkManager.reserve(reservationName, requiresNew);
  }

  beginReserved(reservationName: string, options?: UnitOfWorkOptionsInput): void {
    this.unitOfWorkManager.beginReserved(reservationName, withoutTransaction(options));
  }

  tryBeginReserved(reservationName: string, options?: UnitOfWorkOptionsInput): boolean {
    return this.unitOfWorkManager.tryBeginReserved(reservationName, withoutTransaction(options));
  }
}

function withoutTransaction(options: UnitOfWorkOptionsInput | undefined): AbpUnitOfWorkOptions {
  const result = toOptions(options);
  result.isTransactional = false;
  return result;
}
