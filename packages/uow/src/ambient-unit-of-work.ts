import { AbpAmbientKeys, IAmbientScopeProvider, Singleton, createToken } from "@abp/core";
import type { IUnitOfWork } from "./unit-of-work.js";

/** Port of `IUnitOfWorkAccessor`. */
export interface IUnitOfWorkAccessor {
  readonly unitOfWork: IUnitOfWork | undefined;
  setUnitOfWork(unitOfWork: IUnitOfWork | undefined): void;
}
export const IUnitOfWorkAccessor = createToken<IUnitOfWorkAccessor>("IUnitOfWorkAccessor");

/** Port of `IAmbientUnitOfWork`. */
export interface IAmbientUnitOfWork extends IUnitOfWorkAccessor {
  getCurrentByChecking(): IUnitOfWork | undefined;
  /** Runs `fn` in a forked ambient context so units of work begun inside do not leak to the caller. */
  fork<R>(fn: () => R): R;
}
export const IAmbientUnitOfWork = createToken<IAmbientUnitOfWork>("IAmbientUnitOfWork");

/** Port of `AmbientUnitOfWork` on top of `AmbientScopeProvider` (`AbpAmbientKeys.unitOfWork`). */
@Singleton(IAmbientUnitOfWork, IUnitOfWorkAccessor)
export class AmbientUnitOfWork implements IAmbientUnitOfWork {
  static readonly inject = [IAmbientScopeProvider] as const;

  constructor(private readonly ambientScopeProvider: IAmbientScopeProvider<IUnitOfWork>) {}

  get unitOfWork(): IUnitOfWork | undefined {
    return this.ambientScopeProvider.getValue(AbpAmbientKeys.unitOfWork);
  }

  setUnitOfWork(unitOfWork: IUnitOfWork | undefined): void {
    this.ambientScopeProvider.beginScope(AbpAmbientKeys.unitOfWork, unitOfWork);
  }

  getCurrentByChecking(): IUnitOfWork | undefined {
    let uow = this.unitOfWork;
    while (uow && (uow.isReserved || uow.isDisposed || uow.isCompleted)) uow = uow.outer;
    return uow;
  }

  fork<R>(fn: () => R): R {
    return this.ambientScopeProvider.run(AbpAmbientKeys.unitOfWork, this.unitOfWork, fn);
  }
}
