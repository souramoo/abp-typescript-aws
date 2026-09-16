import { AbpException, Check, IServiceProviderToken, Singleton, Transient, createToken, distinct, optionsToken, type IOptions, type IServiceProvider, type ServiceKey } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, type ClaimsPrincipal } from "@abp/security";
import { AbpPermissionOptions } from "./abp-permission-options.js";
import type { PermissionDefinition } from "./permission-definition.js";
import { MultiplePermissionGrantResult, PermissionGrantResult } from "./permission-grant-result.js";
import { IPermissionStore } from "./permission-store.js";

/** Port of `PermissionValueCheckContext`. */
export class PermissionValueCheckContext {
  constructor(
    readonly permission: PermissionDefinition,
    readonly principal: ClaimsPrincipal | undefined,
  ) {
    Check.notNull(permission, "permission");
  }
}

/** Port of `PermissionValuesCheckContext`. */
export class PermissionValuesCheckContext {
  constructor(
    readonly permissions: PermissionDefinition[],
    readonly principal: ClaimsPrincipal | undefined,
  ) {
    Check.notNull(permissions, "permissions");
  }
}

/** Port of `IPermissionValueProvider`. */
export interface IPermissionValueProvider {
  readonly name: string;
  check(context: PermissionValueCheckContext): Promise<PermissionGrantResult>;
  checkMany(context: PermissionValuesCheckContext): Promise<MultiplePermissionGrantResult>;
}
export const IPermissionValueProvider = createToken<IPermissionValueProvider>("IPermissionValueProvider");

/** Port of `PermissionValueProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class PermissionValueProvider implements IPermissionValueProvider {
  static readonly inject: readonly ServiceKey[] = [IPermissionStore];
  abstract readonly name: string;

  constructor(protected readonly permissionStore: IPermissionStore) {}

  abstract check(context: PermissionValueCheckContext): Promise<PermissionGrantResult>;
  abstract checkMany(context: PermissionValuesCheckContext): Promise<MultiplePermissionGrantResult>;
}

export function distinctPermissionNames(permissions: readonly PermissionDefinition[]): string[] {
  return Check.notNullOrEmptyArray(distinct(permissions.map((p) => p.name)), "permissionNames") as string[];
}

/** Port of `UserPermissionValueProvider` ("U"). */
@Transient()
export class UserPermissionValueProvider extends PermissionValueProvider {
  static readonly ProviderName = "U";
  readonly name = UserPermissionValueProvider.ProviderName;

  async check(context: PermissionValueCheckContext): Promise<PermissionGrantResult> {
    const userId = context.principal?.findFirst(AbpClaimTypes.userId)?.value;
    if (userId === undefined) return PermissionGrantResult.Undefined;
    return (await this.permissionStore.isGranted(context.permission.name, this.name, userId)) ? PermissionGrantResult.Granted : PermissionGrantResult.Undefined;
  }

  async checkMany(context: PermissionValuesCheckContext): Promise<MultiplePermissionGrantResult> {
    const permissionNames = distinctPermissionNames(context.permissions);
    const userId = context.principal?.findFirst(AbpClaimTypes.userId)?.value;
    if (userId === undefined) return new MultiplePermissionGrantResult(permissionNames);
    return this.permissionStore.isGrantedMany(permissionNames, this.name, userId);
  }
}

/** Port of `RolePermissionValueProvider` ("R"). */
@Transient()
export class RolePermissionValueProvider extends PermissionValueProvider {
  static readonly ProviderName = "R";
  readonly name = RolePermissionValueProvider.ProviderName;

  async check(context: PermissionValueCheckContext): Promise<PermissionGrantResult> {
    const roles = rolesOf(context.principal);
    if (roles.length === 0) return PermissionGrantResult.Undefined;
    for (const role of roles) {
      if (await this.permissionStore.isGranted(context.permission.name, this.name, role)) return PermissionGrantResult.Granted;
    }
    return PermissionGrantResult.Undefined;
  }

  async checkMany(context: PermissionValuesCheckContext): Promise<MultiplePermissionGrantResult> {
    const permissionNames = distinctPermissionNames(context.permissions);
    const result = new MultiplePermissionGrantResult(permissionNames);
    const roles = rolesOf(context.principal);
    if (roles.length === 0) return result;
    for (const role of roles) {
      const multipleResult = await this.permissionStore.isGrantedMany(permissionNames, this.name, role);
      mergeDefinedResults(result, multipleResult, permissionNames);
      if (result.allGranted || result.allProhibited || permissionNames.length === 0) break;
    }
    return result;
  }
}

/** Port of `ClientPermissionValueProvider` ("C"): client permissions are always looked up on the host side. */
@Transient()
export class ClientPermissionValueProvider extends PermissionValueProvider {
  static override readonly inject = [IPermissionStore, ICurrentTenant] as const;
  static readonly ProviderName = "C";
  readonly name = ClientPermissionValueProvider.ProviderName;

  constructor(
    permissionStore: IPermissionStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(permissionStore);
  }

  async check(context: PermissionValueCheckContext): Promise<PermissionGrantResult> {
    const clientId = context.principal?.findFirst(AbpClaimTypes.clientId)?.value;
    if (clientId === undefined) return PermissionGrantResult.Undefined;
    const granted = await this.currentTenant.run(undefined, undefined, () => this.permissionStore.isGranted(context.permission.name, this.name, clientId));
    return granted ? PermissionGrantResult.Granted : PermissionGrantResult.Undefined;
  }

  async checkMany(context: PermissionValuesCheckContext): Promise<MultiplePermissionGrantResult> {
    const permissionNames = distinctPermissionNames(context.permissions);
    const clientId = context.principal?.findFirst(AbpClaimTypes.clientId)?.value;
    if (clientId === undefined) return new MultiplePermissionGrantResult(permissionNames);
    return this.currentTenant.run(undefined, undefined, () => this.permissionStore.isGrantedMany(permissionNames, this.name, clientId));
  }
}

export function rolesOf(principal: ClaimsPrincipal | undefined): string[] {
  return principal ? distinct(principal.findAll(AbpClaimTypes.role).map((c) => c.value)) : [];
}

/** Copies every defined result of `source` into still-undefined entries of `target` and drops them from `pendingNames`. */
export function mergeDefinedResults(target: MultiplePermissionGrantResult, source: MultiplePermissionGrantResult, pendingNames: string[]): void {
  for (const [name, grant] of source.result) {
    if (target.result.get(name) === PermissionGrantResult.Undefined && grant !== PermissionGrantResult.Undefined) {
      target.result.set(name, grant);
      const index = pendingNames.indexOf(name);
      if (index >= 0) pendingNames.splice(index, 1);
    }
  }
}

/** Port of `IPermissionValueProviderManager`. */
export interface IPermissionValueProviderManager {
  readonly valueProviders: readonly IPermissionValueProvider[];
}
export const IPermissionValueProviderManager = createToken<IPermissionValueProviderManager>("IPermissionValueProviderManager");

/** Port of `PermissionValueProviderManager`: resolves `AbpPermissionOptions.valueProviders` lazily, once. */
@Singleton(IPermissionValueProviderManager)
export class PermissionValueProviderManager implements IPermissionValueProviderManager {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpPermissionOptions)] as const;
  protected readonly options: AbpPermissionOptions;
  private providers: IPermissionValueProvider[] | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpPermissionOptions>,
  ) {
    this.options = options.value;
  }

  get valueProviders(): readonly IPermissionValueProvider[] {
    this.providers ??= this.getProviders();
    return this.providers;
  }

  protected getProviders(): IPermissionValueProvider[] {
    const providers = this.options.valueProviders.toArray().map((type) => this.serviceProvider.getRequired(type));
    ensureUniqueProviderNames(providers, "permission value provider");
    return providers;
  }
}

export function ensureUniqueProviderNames(providers: readonly { name: string }[], kind: string): void {
  const seen = new Map<string, string[]>();
  for (const p of providers) seen.set(p.name, [...(seen.get(p.name) ?? []), p.constructor.name]);
  for (const [name, types] of seen) {
    if (types.length > 1) throw new AbpException(`Duplicate ${kind} name detected: ${name}. Providers:\n${types.join("\n")}`);
  }
}
