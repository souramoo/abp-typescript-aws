import { AmbientScopeProvider, Check, SimpleBatchStateCheckerContext, SimpleStateCheckerResult, type IHasSimpleStateCheckers, type ISimpleBatchStateChecker, type ISimpleStateChecker, type SimpleStateCheckerContext } from "@abp/core";
import { ICurrentUser } from "@abp/security";
import { IPermissionChecker } from "./permission-checker.js";
import { PermissionGrantResult } from "./permission-grant-result.js";

/** Port of `SimpleBatchStateCheckerBase` (lives here because `@abp/core` only ships the interfaces). */
export abstract class SimpleBatchStateCheckerBase<TState extends IHasSimpleStateCheckers<TState>> implements ISimpleBatchStateChecker<TState> {
  abstract isEnabledBatch(context: SimpleBatchStateCheckerContext<TState>): Promise<SimpleStateCheckerResult<TState>>;

  async isEnabled(context: SimpleStateCheckerContext<TState>): Promise<boolean> {
    const result = await this.isEnabledBatch(new SimpleBatchStateCheckerContext(context.serviceProvider, [context.state]));
    return result.get(context.state) ?? false;
  }
}

/** Port of `RequireAuthenticatedSimpleStateChecker`. */
export class RequireAuthenticatedSimpleStateChecker<TState extends IHasSimpleStateCheckers<TState>> implements ISimpleStateChecker<TState> {
  async isEnabled(context: SimpleStateCheckerContext<TState>): Promise<boolean> {
    return context.serviceProvider.getRequired(ICurrentUser).isAuthenticated;
  }
}

/** Port of `RequirePermissionsSimpleBatchStateCheckerModel`. */
export class RequirePermissionsSimpleBatchStateCheckerModel<TState extends IHasSimpleStateCheckers<TState>> {
  readonly permissions: readonly string[];
  constructor(
    readonly state: TState,
    permissions: readonly string[],
    readonly requiresAll = true,
  ) {
    Check.notNull(state, "state");
    this.permissions = Check.notNullOrEmptyArray(permissions, "permissions");
  }
}

/** Port of `RequirePermissionsSimpleStateChecker`. */
export class RequirePermissionsSimpleStateChecker<TState extends IHasSimpleStateCheckers<TState>> implements ISimpleStateChecker<TState> {
  constructor(private readonly model: RequirePermissionsSimpleBatchStateCheckerModel<TState>) {}

  get requiresAll(): boolean {
    return this.model.requiresAll;
  }
  get permissionNames(): readonly string[] {
    return this.model.permissions;
  }

  async isEnabled(context: SimpleStateCheckerContext<TState>): Promise<boolean> {
    const permissionChecker = context.serviceProvider.getRequired(IPermissionChecker);
    if (this.model.permissions.length === 1) return permissionChecker.isGranted(this.model.permissions[0]!);
    const grantResult = await permissionChecker.isGranted(this.model.permissions);
    return this.model.requiresAll ? grantResult.allGranted : this.model.permissions.some((p) => grantResult.isGranted(p));
  }
}

const currentBatchChecker = new AmbientScopeProvider<RequirePermissionsSimpleBatchStateChecker<never>>();
const CURRENT_KEY = "Abp.Authorization.RequirePermissionsSimpleBatchStateChecker";

/**
 * Port of `RequirePermissionsSimpleBatchStateChecker`. `Current` is ambient (`AsyncLocal` in .NET) so every state
 * defined in one async flow shares a checker and its permissions are checked in one batch. The .NET type is closed
 * per `TState`; here one ambient slot is shared by all state types.
 */
export class RequirePermissionsSimpleBatchStateChecker<TState extends IHasSimpleStateCheckers<TState>> extends SimpleBatchStateCheckerBase<TState> {
  private readonly models: RequirePermissionsSimpleBatchStateCheckerModel<TState>[] = [];
  private readonly modelsByState = new Map<TState, RequirePermissionsSimpleBatchStateCheckerModel<TState>>();

  static get current(): RequirePermissionsSimpleBatchStateChecker<never> {
    let checker = currentBatchChecker.getValue(CURRENT_KEY);
    if (!checker) {
      checker = new RequirePermissionsSimpleBatchStateChecker<never>();
      currentBatchChecker.beginScope(CURRENT_KEY, checker);
    }
    return checker;
  }

  static currentFor<TState extends IHasSimpleStateCheckers<TState>>(): RequirePermissionsSimpleBatchStateChecker<TState> {
    return RequirePermissionsSimpleBatchStateChecker.current as unknown as RequirePermissionsSimpleBatchStateChecker<TState>;
  }

  static use(checker: RequirePermissionsSimpleBatchStateChecker<never>): Disposable {
    return currentBatchChecker.beginScope(CURRENT_KEY, checker);
  }

  addCheckModels(...models: RequirePermissionsSimpleBatchStateCheckerModel<TState>[]): this {
    Check.notNullOrEmptyArray(models, "models");
    this.models.push(...models);
    for (const model of models) if (!this.modelsByState.has(model.state)) this.modelsByState.set(model.state, model);
    return this;
  }

  getModelOrNull(state: TState): RequirePermissionsSimpleBatchStateCheckerModel<TState> | undefined {
    return this.modelsByState.get(state);
  }

  override async isEnabledBatch(context: SimpleBatchStateCheckerContext<TState>): Promise<SimpleStateCheckerResult<TState>> {
    const permissionChecker = context.serviceProvider.getRequired(IPermissionChecker);
    const result = new SimpleStateCheckerResult(context.states);
    const stateSet = new Set(context.states);
    const modelLookup = new Map<TState, RequirePermissionsSimpleBatchStateCheckerModel<TState>>();
    const allPermissions = new Set<string>();

    for (const model of this.models) {
      if (!stateSet.has(model.state)) continue;
      if (!modelLookup.has(model.state)) modelLookup.set(model.state, model);
      for (const permission of model.permissions) allPermissions.add(permission);
    }

    const grantResult = await permissionChecker.isGranted([...allPermissions]);
    for (const state of context.states) {
      const model = modelLookup.get(state);
      if (!model) continue;
      const granted = (p: string) => grantResult.result.get(p) === PermissionGrantResult.Granted;
      result.set(state, model.requiresAll ? model.permissions.every(granted) : model.permissions.some(granted));
    }
    return result;
  }
}

/* Port of `PermissionSimpleStateCheckerExtensions`. */

/** `state.RequireAuthenticated()`. */
export function requireAuthenticated<TState extends IHasSimpleStateCheckers<TState>>(state: TState): TState {
  state.stateCheckers.push(new RequireAuthenticatedSimpleStateChecker<TState>());
  return state;
}

export interface RequirePermissionsOptions {
  /** Default: true. */
  requiresAll?: boolean;
  /** Default: true (shares the ambient batch checker). */
  batchCheck?: boolean;
}

/** `state.RequirePermissions(requiresAll, batchCheck, ...permissions)`. */
export function requirePermissions<TState extends IHasSimpleStateCheckers<TState>>(state: TState, permissions: readonly string[], options: RequirePermissionsOptions = {}): TState {
  Check.notNull(state, "state");
  Check.notNullOrEmptyArray(permissions, "permissions");
  const model = new RequirePermissionsSimpleBatchStateCheckerModel(state, permissions, options.requiresAll ?? true);
  if (options.batchCheck ?? true) {
    const checker = RequirePermissionsSimpleBatchStateChecker.currentFor<TState>();
    checker.addCheckModels(model);
    state.stateCheckers.push(checker);
  } else {
    state.stateCheckers.push(new RequirePermissionsSimpleStateChecker(model));
  }
  return state;
}
