import { Check, Transient, createToken, removeAll, simpleStateCheckerManagerToken, type IServiceProvider, type ISimpleStateCheckerManager } from "@abp/core";
import { getMultiTenancySideOf } from "@abp/multi-tenancy";
import { ICurrentTenant, getMultiTenancySide, hasMultiTenancySide, type MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { ICurrentPrincipalAccessor, type ClaimsPrincipal } from "@abp/security";
import { PermissionDefinition } from "./permission-definition.js";
import { IPermissionDefinitionManager } from "./permission-definition-store.js";
import { MultiplePermissionGrantResult, PermissionGrantResult } from "./permission-grant-result.js";
import { IPermissionValueProviderManager, PermissionValueCheckContext, PermissionValuesCheckContext } from "./permission-value-provider.js";

/** Port of `IPermissionChecker` (the four `IsGrantedAsync` overloads). */
export interface IPermissionChecker {
  isGranted(name: string): Promise<boolean>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, name: string): Promise<boolean>;
  isGranted(names: readonly string[]): Promise<MultiplePermissionGrantResult>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[]): Promise<MultiplePermissionGrantResult>;
}
export const IPermissionChecker = createToken<IPermissionChecker>("IPermissionChecker");

/** The service token of the `ISimpleStateCheckerManager<PermissionDefinition>` used by permission checking. */
export const IPermissionStateCheckerManager = simpleStateCheckerManagerToken(PermissionDefinition);

/** Port of `PermissionStateContext`. */
export class PermissionStateContext {
  constructor(
    public serviceProvider: IServiceProvider,
    public permission: PermissionDefinition,
  ) {}
}

type IsGrantedArgs = [name: string] | [names: readonly string[]] | [principal: ClaimsPrincipal | undefined, name: string] | [principal: ClaimsPrincipal | undefined, names: readonly string[]];

/** Splits the overloaded `isGranted` arguments into (principal | "current", name | names). */
export function parseIsGrantedArgs(args: IsGrantedArgs): { principal: ClaimsPrincipal | undefined; useCurrent: boolean; target: string | readonly string[] } {
  if (args.length === 1) return { principal: undefined, useCurrent: true, target: args[0] };
  return { principal: args[0], useCurrent: false, target: args[1] };
}

/** Port of `PermissionChecker`. */
@Transient(IPermissionChecker)
export class PermissionChecker implements IPermissionChecker {
  static readonly inject = [ICurrentPrincipalAccessor, IPermissionDefinitionManager, ICurrentTenant, IPermissionValueProviderManager, IPermissionStateCheckerManager] as const;

  constructor(
    protected readonly principalAccessor: ICurrentPrincipalAccessor,
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly permissionValueProviderManager: IPermissionValueProviderManager,
    protected readonly stateCheckerManager: ISimpleStateCheckerManager<PermissionDefinition>,
  ) {}

  isGranted(name: string): Promise<boolean>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, name: string): Promise<boolean>;
  isGranted(names: readonly string[]): Promise<MultiplePermissionGrantResult>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[]): Promise<MultiplePermissionGrantResult>;
  isGranted(...args: IsGrantedArgs): Promise<boolean | MultiplePermissionGrantResult> {
    const { principal, useCurrent, target } = parseIsGrantedArgs(args);
    const claimsPrincipal = useCurrent ? this.principalAccessor.principal : principal;
    return typeof target === "string" ? this.isGrantedFor(claimsPrincipal, target) : this.isGrantedManyFor(claimsPrincipal, target);
  }

  protected multiTenancySideOf(claimsPrincipal: ClaimsPrincipal | undefined): MultiTenancySides {
    return claimsPrincipal ? getMultiTenancySideOf(claimsPrincipal) : getMultiTenancySide(this.currentTenant);
  }

  protected async isGrantedFor(claimsPrincipal: ClaimsPrincipal | undefined, name: string): Promise<boolean> {
    Check.notNull(name, "name");
    const permission = await this.permissionDefinitionManager.getOrNull(name);
    if (!permission || !permission.isEnabled) return false;
    if (!(await this.stateCheckerManager.isEnabled(permission))) return false;
    if (!hasMultiTenancySide(permission.multiTenancySide, this.multiTenancySideOf(claimsPrincipal))) return false;

    let isGranted = false;
    const context = new PermissionValueCheckContext(permission, claimsPrincipal);
    for (const provider of this.permissionValueProviderManager.valueProviders) {
      if (permission.providers.length > 0 && !permission.providers.includes(provider.name)) continue;
      const result = await provider.check(context);
      if (result === PermissionGrantResult.Granted) isGranted = true;
      else if (result === PermissionGrantResult.Prohibited) return false;
    }
    return isGranted;
  }

  protected async isGrantedManyFor(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[]): Promise<MultiplePermissionGrantResult> {
    Check.notNull(names, "names");
    const result = new MultiplePermissionGrantResult();
    if (names.length === 0) return result;

    const multiTenancySide = this.multiTenancySideOf(claimsPrincipal);
    const allPermissions = new Map((await this.permissionDefinitionManager.getPermissions()).map((p) => [p.name, p]));
    const pendingStateCheck: PermissionDefinition[] = [];
    const permissionDefinitions: PermissionDefinition[] = [];

    for (const name of names) {
      const permission = allPermissions.get(name);
      if (!permission) {
        result.result.set(name, PermissionGrantResult.Prohibited);
        continue;
      }
      result.result.set(name, PermissionGrantResult.Undefined);
      if (!permission.isEnabled || !hasMultiTenancySide(permission.multiTenancySide, multiTenancySide)) continue;
      pendingStateCheck.push(permission);
    }

    if (pendingStateCheck.length > 0) {
      const stateCheckResult = await this.stateCheckerManager.isEnabledMany(pendingStateCheck);
      for (const [permission, enabled] of stateCheckResult) if (enabled) permissionDefinitions.push(permission);
    }

    for (const provider of this.permissionValueProviderManager.valueProviders) {
      const permissions = permissionDefinitions.filter((x) => x.providers.length === 0 || x.providers.includes(provider.name));
      if (permissions.length === 0) continue;

      const multipleResult = await provider.checkMany(new PermissionValuesCheckContext(permissions, claimsPrincipal));
      for (const [name, grant] of multipleResult.result) {
        if (!result.result.has(name)) continue;
        if (grant === PermissionGrantResult.Granted) {
          if (result.result.get(name) !== PermissionGrantResult.Prohibited) result.result.set(name, PermissionGrantResult.Granted);
        } else if (grant === PermissionGrantResult.Prohibited) {
          result.result.set(name, PermissionGrantResult.Prohibited);
          removeAll(permissionDefinitions, (x) => x.name === name);
        }
      }
      if (result.allProhibited) break;
    }

    return result;
  }
}

/** Port of `AlwaysAllowPermissionChecker`: grants every permission (useful for tests). */
export class AlwaysAllowPermissionChecker implements IPermissionChecker {
  isGranted(name: string): Promise<boolean>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, name: string): Promise<boolean>;
  isGranted(names: readonly string[]): Promise<MultiplePermissionGrantResult>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[]): Promise<MultiplePermissionGrantResult>;
  async isGranted(...args: IsGrantedArgs): Promise<boolean | MultiplePermissionGrantResult> {
    const { target } = parseIsGrantedArgs(args);
    return typeof target === "string" ? true : new MultiplePermissionGrantResult(target, PermissionGrantResult.Granted);
  }
}
