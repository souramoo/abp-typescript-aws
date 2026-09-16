import { AmbientScopeProvider, Check, SimpleStateCheckerResult, type IHasSimpleStateCheckers, type ISimpleStateChecker, type SimpleBatchStateCheckerContext, type SimpleStateCheckerContext } from "@abp/core";
import { SimpleBatchStateCheckerBase } from "@abp/authorization";
import { FeatureCheckerExtensions, IFeatureChecker } from "./feature-checker.js";

/** Port of `RequireFeaturesSimpleStateChecker`. */
export class RequireFeaturesSimpleStateChecker<TState extends IHasSimpleStateCheckers<TState>> implements ISimpleStateChecker<TState> {
  readonly featureNames: readonly string[];
  constructor(
    readonly requiresAll: boolean,
    featureNames: readonly string[],
  ) {
    this.featureNames = Check.notNullOrEmptyArray(featureNames, "featureNames");
  }

  isEnabled(context: SimpleStateCheckerContext<TState>): Promise<boolean> {
    return FeatureCheckerExtensions.isEnabled(context.serviceProvider.getRequired(IFeatureChecker), this.requiresAll, this.featureNames);
  }
}

/** Port of `RequireFeaturesSimpleBatchStateCheckerModel`. */
export class RequireFeaturesSimpleBatchStateCheckerModel<TState extends IHasSimpleStateCheckers<TState>> {
  readonly featureNames: readonly string[];
  constructor(
    readonly state: TState,
    featureNames: readonly string[],
    readonly requiresAll = true,
  ) {
    Check.notNull(state, "state");
    this.featureNames = Check.notNullOrEmptyArray(featureNames, "featureNames");
  }
}

const currentBatchChecker = new AmbientScopeProvider<RequireFeaturesSimpleBatchStateChecker<never>>();
const CURRENT_KEY = "Abp.Features.RequireFeaturesSimpleBatchStateChecker";

/**
 * Port of `RequireFeaturesSimpleBatchStateChecker`. `Current` is ambient (`AsyncLocal` in .NET) so every state
 * defined in one async flow shares a checker and its features are checked in one batch. The .NET type is closed
 * per `TState`; here one ambient slot is shared by all state types.
 */
export class RequireFeaturesSimpleBatchStateChecker<TState extends IHasSimpleStateCheckers<TState>> extends SimpleBatchStateCheckerBase<TState> {
  private readonly models: RequireFeaturesSimpleBatchStateCheckerModel<TState>[] = [];
  private readonly modelsByState = new Map<TState, RequireFeaturesSimpleBatchStateCheckerModel<TState>>();

  static get current(): RequireFeaturesSimpleBatchStateChecker<never> {
    let checker = currentBatchChecker.getValue(CURRENT_KEY);
    if (!checker) {
      checker = new RequireFeaturesSimpleBatchStateChecker<never>();
      currentBatchChecker.beginScope(CURRENT_KEY, checker);
    }
    return checker;
  }

  static currentFor<TState extends IHasSimpleStateCheckers<TState>>(): RequireFeaturesSimpleBatchStateChecker<TState> {
    return RequireFeaturesSimpleBatchStateChecker.current as unknown as RequireFeaturesSimpleBatchStateChecker<TState>;
  }

  static use(checker: RequireFeaturesSimpleBatchStateChecker<never>): Disposable {
    return currentBatchChecker.beginScope(CURRENT_KEY, checker);
  }

  addCheckModels(...models: RequireFeaturesSimpleBatchStateCheckerModel<TState>[]): this {
    Check.notNullOrEmptyArray(models, "models");
    this.models.push(...models);
    for (const model of models) if (!this.modelsByState.has(model.state)) this.modelsByState.set(model.state, model);
    return this;
  }

  getModelOrNull(state: TState): RequireFeaturesSimpleBatchStateCheckerModel<TState> | undefined {
    return this.modelsByState.get(state);
  }

  override async isEnabledBatch(context: SimpleBatchStateCheckerContext<TState>): Promise<SimpleStateCheckerResult<TState>> {
    const featureChecker = context.serviceProvider.getRequired(IFeatureChecker);
    const result = new SimpleStateCheckerResult(context.states);
    const stateSet = new Set(context.states);
    const modelLookup = new Map<TState, RequireFeaturesSimpleBatchStateCheckerModel<TState>>();
    const allFeatures = new Set<string>();

    for (const model of this.models) {
      if (!stateSet.has(model.state)) continue;
      if (!modelLookup.has(model.state)) modelLookup.set(model.state, model);
      for (const featureName of model.featureNames) allFeatures.add(featureName);
    }

    const featureValues = await featureChecker.isEnabledMany([...allFeatures]);
    for (const state of context.states) {
      const model = modelLookup.get(state);
      if (!model) continue;
      const enabled = (name: string) => featureValues.get(name) === true;
      result.set(state, model.requiresAll ? model.featureNames.every(enabled) : model.featureNames.some(enabled));
    }
    return result;
  }
}

export interface RequireFeaturesOptions {
  /** Default: true. */
  requiresAll?: boolean;
  /** Default: true (shares the ambient batch checker). */
  batchCheck?: boolean;
}

/** Port of `FeatureSimpleStateCheckerExtensions.RequireFeatures` (e.g. on a `PermissionDefinition`). */
export function requireFeatures<TState extends IHasSimpleStateCheckers<TState>>(state: TState, features: readonly string[], options: RequireFeaturesOptions = {}): TState {
  Check.notNull(state, "state");
  Check.notNullOrEmptyArray(features, "features");
  const requiresAll = options.requiresAll ?? true;
  if (options.batchCheck ?? true) {
    const checker = RequireFeaturesSimpleBatchStateChecker.currentFor<TState>();
    checker.addCheckModels(new RequireFeaturesSimpleBatchStateCheckerModel(state, features, requiresAll));
    state.stateCheckers.push(checker);
  } else {
    state.stateCheckers.push(new RequireFeaturesSimpleStateChecker(requiresAll, features));
  }
  return state;
}
