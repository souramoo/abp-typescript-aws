import { TypeList } from "../collections/type-list.js";
import { IServiceProviderToken, type IServiceProvider } from "../dependency-injection/service-provider.js";
import { createToken, keyedToken, type Class, type ServiceToken } from "../dependency-injection/service-token.js";

/** Port of `Volo.Abp.SimpleStateChecking` used by permission/feature/setting definitions. */
export interface IHasSimpleStateCheckers<TState extends IHasSimpleStateCheckers<TState>> {
  readonly stateCheckers: ISimpleStateChecker<TState>[];
}

export class SimpleStateCheckerContext<TState extends IHasSimpleStateCheckers<TState>> {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly state: TState,
  ) {}
}

export class SimpleBatchStateCheckerContext<TState extends IHasSimpleStateCheckers<TState>> {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly states: readonly TState[],
  ) {}
}

export interface ISimpleStateChecker<TState extends IHasSimpleStateCheckers<TState>> {
  isEnabled(context: SimpleStateCheckerContext<TState>): Promise<boolean>;
}

export interface ISimpleBatchStateChecker<TState extends IHasSimpleStateCheckers<TState>> extends ISimpleStateChecker<TState> {
  isEnabledBatch(context: SimpleBatchStateCheckerContext<TState>): Promise<Map<TState, boolean>>;
}

export function isBatchStateChecker<TState extends IHasSimpleStateCheckers<TState>>(checker: ISimpleStateChecker<TState>): checker is ISimpleBatchStateChecker<TState> {
  return typeof (checker as ISimpleBatchStateChecker<TState>).isEnabledBatch === "function";
}

export class SimpleStateCheckerResult<TState extends IHasSimpleStateCheckers<TState>> extends Map<TState, boolean> {
  constructor(states: readonly TState[], initial = true) {
    super(states.map((s) => [s, initial] as const));
  }
}

export class AbpSimpleStateCheckerOptions<TState extends IHasSimpleStateCheckers<TState>> {
  readonly globalStateCheckers = new TypeList<ISimpleStateChecker<TState>>();
}

export interface ISimpleStateCheckerManager<TState extends IHasSimpleStateCheckers<TState>> {
  isEnabled(state: TState): Promise<boolean>;
  isEnabledMany(states: readonly TState[]): Promise<SimpleStateCheckerResult<TState>>;
}

const ISimpleStateCheckerManagerBase = createToken<unknown>("ISimpleStateCheckerManager");
export function simpleStateCheckerManagerToken<TState extends IHasSimpleStateCheckers<TState>>(stateType: Class<TState>): ServiceToken<ISimpleStateCheckerManager<TState>> {
  return keyedToken<ISimpleStateCheckerManager<TState>>(ISimpleStateCheckerManagerBase, stateType);
}

export class SimpleStateCheckerManager<TState extends IHasSimpleStateCheckers<TState>> implements ISimpleStateCheckerManager<TState> {
  static readonly inject = [IServiceProviderToken] as const;
  constructor(
    protected readonly serviceProvider: IServiceProvider,
    protected readonly globalStateCheckers: TypeList<ISimpleStateChecker<TState>> = new TypeList(),
  ) {}

  async isEnabled(state: TState): Promise<boolean> {
    const context = new SimpleStateCheckerContext(this.serviceProvider, state);
    for (const checker of state.stateCheckers) {
      if (!(await checker.isEnabled(context))) return false;
    }
    for (const type of this.globalStateCheckers) {
      const checker = this.serviceProvider.getRequired(type);
      if (!(await checker.isEnabled(context))) return false;
    }
    return true;
  }

  async isEnabledMany(states: readonly TState[]): Promise<SimpleStateCheckerResult<TState>> {
    const result = new SimpleStateCheckerResult(states);
    const batchCheckers = new Set<ISimpleBatchStateChecker<TState>>();
    for (const s of states) for (const c of s.stateCheckers) if (isBatchStateChecker(c)) batchCheckers.add(c);
    for (const checker of batchCheckers) {
      const subject = states.filter((s) => s.stateCheckers.includes(checker));
      const batch = await checker.isEnabledBatch(new SimpleBatchStateCheckerContext(this.serviceProvider, subject));
      for (const [state, enabled] of batch) result.set(state, (result.get(state) ?? true) && enabled);
    }
    for (const state of states) {
      if (!result.get(state)) continue;
      const context = new SimpleStateCheckerContext(this.serviceProvider, state);
      for (const checker of state.stateCheckers) {
        if (isBatchStateChecker(checker)) continue;
        if (!(await checker.isEnabled(context))) {
          result.set(state, false);
          break;
        }
      }
      if (!result.get(state)) continue;
      for (const type of this.globalStateCheckers) {
        if (!(await this.serviceProvider.getRequired(type).isEnabled(context))) {
          result.set(state, false);
          break;
        }
      }
    }
    return result;
  }
}
