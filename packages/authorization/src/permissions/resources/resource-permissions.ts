import { AbpException, Check, Dependency, IServiceProviderToken, ServiceLifetime, Singleton, Transient, createToken, isNullOrEmptyString, optionsToken, removeAll, simpleStateCheckerManagerToken, type IKeyedObject, type IOptions, type IServiceProvider, type ISimpleStateCheckerManager, type ServiceKey } from "@abp/core";
import { getMultiTenancySideOf } from "@abp/multi-tenancy";
import { ICurrentTenant, getMultiTenancySide, hasMultiTenancySide, type MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, ICurrentPrincipalAccessor, type ClaimsPrincipal } from "@abp/security";
import { AbpPermissionOptions } from "../abp-permission-options.js";
import { IPermissionChecker, parseIsGrantedArgs } from "../permission-checker.js";
import { PermissionDefinition } from "../permission-definition.js";
import { IPermissionDefinitionManager } from "../permission-definition-store.js";
import { MultiplePermissionGrantResult, PermissionGrantInfo, PermissionGrantResult } from "../permission-grant-result.js";
import { PermissionValueCheckContext, PermissionValuesCheckContext, distinctPermissionNames, ensureUniqueProviderNames, mergeDefinedResults, rolesOf } from "../permission-value-provider.js";

/** Port of `IHasResourcePermissions`. */
export interface IHasResourcePermissions extends IKeyedObject {
  resourcePermissions: Map<string, boolean> | undefined;
}

/** Port of `IKeyedObject.GetObjectKey()`. */
export function getObjectKey(resource: IKeyedObject): string | undefined {
  return isNullOrEmptyString(resource.key) ? undefined : resource.key;
}

/** Port of `typeof(TResource).FullName` used as the resource name: the class name of the instance. */
export function resourceNameOf(resource: object): string {
  return resource.constructor.name;
}

/** Port of `ResourcePermissionGrantInfo`. */
export class ResourcePermissionGrantInfo extends PermissionGrantInfo {
  constructor(
    name: string,
    isGranted: boolean,
    readonly resourceName: string,
    readonly resourceKey: string,
    providerName?: string,
    providerKey?: string,
  ) {
    super(name, isGranted, providerName, providerKey);
  }
}

/** Port of `IResourcePermissionStore`. */
export interface IResourcePermissionStore {
  isGranted(name: string, resourceName: string, resourceKey: string, providerName: string, providerKey: string): Promise<boolean>;
  isGrantedMany(names: readonly string[], resourceName: string, resourceKey: string, providerName: string, providerKey: string): Promise<MultiplePermissionGrantResult>;
  getPermissions(resourceName: string, resourceKey: string): Promise<MultiplePermissionGrantResult>;
  getGrantedPermissions(resourceName: string, resourceKey: string): Promise<string[]>;
  getGrantedResourceKeys(resourceName: string, name: string): Promise<string[]>;
}
export const IResourcePermissionStore = createToken<IResourcePermissionStore>("IResourcePermissionStore");

/** Port of `NullResourcePermissionStore`. */
@Dependency({ lifetime: ServiceLifetime.Singleton, tryRegister: true, exposes: [IResourcePermissionStore] })
export class NullResourcePermissionStore implements IResourcePermissionStore {
  async isGranted(): Promise<boolean> {
    return false;
  }
  async isGrantedMany(names: readonly string[]): Promise<MultiplePermissionGrantResult> {
    return new MultiplePermissionGrantResult(names, PermissionGrantResult.Prohibited);
  }
  async getPermissions(): Promise<MultiplePermissionGrantResult> {
    return new MultiplePermissionGrantResult();
  }
  async getGrantedPermissions(): Promise<string[]> {
    return [];
  }
  async getGrantedResourceKeys(): Promise<string[]> {
    return [];
  }
}

/* Port of `ResourcePermissionStoreExtensions` + `KeyedObjectResourcePermissionStoreExtensions`. */
export const ResourcePermissionStoreExtensions = {
  async getPermissions(store: IResourcePermissionStore, resource: object, resourceKey?: string): Promise<Map<string, boolean>> {
    const key = resourceKey ?? keyOf(resource);
    const result = await store.getPermissions(resourceNameOf(resource), key);
    return new Map([...result.result].map(([name, grant]) => [name, grant === PermissionGrantResult.Granted]));
  },
  async getGrantedPermissions(store: IResourcePermissionStore, resource: object, resourceKey?: string): Promise<string[]> {
    return [...(await ResourcePermissionStoreExtensions.getPermissions(store, resource, resourceKey))].filter(([, granted]) => granted).map(([name]) => name);
  },
  getGrantedResourceKeys(store: IResourcePermissionStore, resource: object, permissionName: string): Promise<string[]> {
    Check.notNullOrWhiteSpace(permissionName, "permissionName");
    return store.getGrantedResourceKeys(resourceNameOf(resource), permissionName);
  },
};

function keyOf(resource: object): string {
  const key = "key" in resource ? getObjectKey(resource as IKeyedObject) : undefined;
  if (key === undefined) throw new AbpException("The resource doesn't have a key.");
  return key;
}

/** Port of `ResourcePermissionValueCheckContext`. */
export class ResourcePermissionValueCheckContext extends PermissionValueCheckContext {
  constructor(
    permission: PermissionDefinition,
    principal: ClaimsPrincipal | undefined,
    readonly resourceName: string,
    readonly resourceKey: string,
  ) {
    super(permission, principal);
  }
}

/** Port of `ResourcePermissionValuesCheckContext`. */
export class ResourcePermissionValuesCheckContext extends PermissionValuesCheckContext {
  constructor(
    permissions: PermissionDefinition[],
    principal: ClaimsPrincipal | undefined,
    readonly resourceName: string,
    readonly resourceKey: string,
  ) {
    super(permissions, principal);
  }
}

/** Port of `IResourcePermissionValueProvider`. */
export interface IResourcePermissionValueProvider {
  readonly name: string;
  check(context: ResourcePermissionValueCheckContext): Promise<PermissionGrantResult>;
  checkMany(context: ResourcePermissionValuesCheckContext): Promise<MultiplePermissionGrantResult>;
}
export const IResourcePermissionValueProvider = createToken<IResourcePermissionValueProvider>("IResourcePermissionValueProvider");

/** Port of `ResourcePermissionValueProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class ResourcePermissionValueProvider implements IResourcePermissionValueProvider {
  static readonly inject: readonly ServiceKey[] = [IResourcePermissionStore];
  abstract readonly name: string;

  constructor(protected readonly resourcePermissionStore: IResourcePermissionStore) {}

  abstract check(context: ResourcePermissionValueCheckContext): Promise<PermissionGrantResult>;
  abstract checkMany(context: ResourcePermissionValuesCheckContext): Promise<MultiplePermissionGrantResult>;
}

/** Port of `UserResourcePermissionValueProvider` ("U"). */
@Transient()
export class UserResourcePermissionValueProvider extends ResourcePermissionValueProvider {
  static readonly ProviderName = "U";
  readonly name = UserResourcePermissionValueProvider.ProviderName;

  async check(context: ResourcePermissionValueCheckContext): Promise<PermissionGrantResult> {
    const userId = context.principal?.findFirst(AbpClaimTypes.userId)?.value;
    if (userId === undefined) return PermissionGrantResult.Undefined;
    const granted = await this.resourcePermissionStore.isGranted(context.permission.name, context.resourceName, context.resourceKey, this.name, userId);
    return granted ? PermissionGrantResult.Granted : PermissionGrantResult.Undefined;
  }

  async checkMany(context: ResourcePermissionValuesCheckContext): Promise<MultiplePermissionGrantResult> {
    const permissionNames = distinctPermissionNames(context.permissions);
    const userId = context.principal?.findFirst(AbpClaimTypes.userId)?.value;
    if (userId === undefined) return new MultiplePermissionGrantResult(permissionNames);
    return this.resourcePermissionStore.isGrantedMany(permissionNames, context.resourceName, context.resourceKey, this.name, userId);
  }
}

/** Port of `RoleResourcePermissionValueProvider` ("R"). */
@Transient()
export class RoleResourcePermissionValueProvider extends ResourcePermissionValueProvider {
  static readonly ProviderName = "R";
  readonly name = RoleResourcePermissionValueProvider.ProviderName;

  async check(context: ResourcePermissionValueCheckContext): Promise<PermissionGrantResult> {
    for (const role of rolesOf(context.principal)) {
      if (await this.resourcePermissionStore.isGranted(context.permission.name, context.resourceName, context.resourceKey, this.name, role)) return PermissionGrantResult.Granted;
    }
    return PermissionGrantResult.Undefined;
  }

  async checkMany(context: ResourcePermissionValuesCheckContext): Promise<MultiplePermissionGrantResult> {
    const permissionNames = distinctPermissionNames(context.permissions);
    const result = new MultiplePermissionGrantResult(permissionNames);
    for (const role of rolesOf(context.principal)) {
      const multipleResult = await this.resourcePermissionStore.isGrantedMany(permissionNames, context.resourceName, context.resourceKey, this.name, role);
      mergeDefinedResults(result, multipleResult, permissionNames);
      if (result.allGranted || result.allProhibited || permissionNames.length === 0) break;
    }
    return result;
  }
}

/** Port of `ClientResourcePermissionValueProvider` ("C"). */
@Transient()
export class ClientResourcePermissionValueProvider extends ResourcePermissionValueProvider {
  static override readonly inject = [IResourcePermissionStore, ICurrentTenant] as const;
  static readonly ProviderName = "C";
  readonly name = ClientResourcePermissionValueProvider.ProviderName;

  constructor(
    resourcePermissionStore: IResourcePermissionStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(resourcePermissionStore);
  }

  async check(context: ResourcePermissionValueCheckContext): Promise<PermissionGrantResult> {
    const clientId = context.principal?.findFirst(AbpClaimTypes.clientId)?.value;
    if (clientId === undefined) return PermissionGrantResult.Undefined;
    const granted = await this.currentTenant.run(undefined, undefined, () => this.resourcePermissionStore.isGranted(context.permission.name, context.resourceName, context.resourceKey, this.name, clientId));
    return granted ? PermissionGrantResult.Granted : PermissionGrantResult.Undefined;
  }

  async checkMany(context: ResourcePermissionValuesCheckContext): Promise<MultiplePermissionGrantResult> {
    const permissionNames = distinctPermissionNames(context.permissions);
    const clientId = context.principal?.findFirst(AbpClaimTypes.clientId)?.value;
    if (clientId === undefined) return new MultiplePermissionGrantResult(permissionNames);
    return this.currentTenant.run(undefined, undefined, () => this.resourcePermissionStore.isGrantedMany(permissionNames, context.resourceName, context.resourceKey, this.name, clientId));
  }
}

/** Port of `IResourcePermissionValueProviderManager`. */
export interface IResourcePermissionValueProviderManager {
  readonly valueProviders: readonly IResourcePermissionValueProvider[];
}
export const IResourcePermissionValueProviderManager = createToken<IResourcePermissionValueProviderManager>("IResourcePermissionValueProviderManager");

/** Port of `ResourcePermissionValueProviderManager`. */
@Singleton(IResourcePermissionValueProviderManager)
export class ResourcePermissionValueProviderManager implements IResourcePermissionValueProviderManager {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpPermissionOptions)] as const;
  protected readonly options: AbpPermissionOptions;
  private providers: IResourcePermissionValueProvider[] | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpPermissionOptions>,
  ) {
    this.options = options.value;
  }

  get valueProviders(): readonly IResourcePermissionValueProvider[] {
    this.providers ??= this.getProviders();
    return this.providers;
  }

  protected getProviders(): IResourcePermissionValueProvider[] {
    const providers = this.options.resourceValueProviders.toArray().map((type) => this.serviceProvider.getRequired(type));
    ensureUniqueProviderNames(providers, "resource permission value provider");
    return providers;
  }
}

/** Port of `IResourcePermissionChecker` (the four `IsGrantedAsync` overloads). */
export interface IResourcePermissionChecker {
  isGranted(name: string, resourceName: string, resourceKey: string): Promise<boolean>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, name: string, resourceName: string, resourceKey: string): Promise<boolean>;
  isGranted(names: readonly string[], resourceName: string, resourceKey: string): Promise<MultiplePermissionGrantResult>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[], resourceName: string, resourceKey: string): Promise<MultiplePermissionGrantResult>;
}
export const IResourcePermissionChecker = createToken<IResourcePermissionChecker>("IResourcePermissionChecker");

type ResourceIsGrantedArgs =
  | [name: string, resourceName: string, resourceKey: string]
  | [names: readonly string[], resourceName: string, resourceKey: string]
  | [principal: ClaimsPrincipal | undefined, name: string, resourceName: string, resourceKey: string]
  | [principal: ClaimsPrincipal | undefined, names: readonly string[], resourceName: string, resourceKey: string];

/** Port of `ResourcePermissionChecker`. */
@Transient(IResourcePermissionChecker)
export class ResourcePermissionChecker implements IResourcePermissionChecker {
  static readonly inject = [ICurrentPrincipalAccessor, IPermissionDefinitionManager, ICurrentTenant, IResourcePermissionValueProviderManager, simpleStateCheckerManagerToken(PermissionDefinition), IPermissionChecker] as const;

  constructor(
    protected readonly principalAccessor: ICurrentPrincipalAccessor,
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly permissionValueProviderManager: IResourcePermissionValueProviderManager,
    protected readonly stateCheckerManager: ISimpleStateCheckerManager<PermissionDefinition>,
    protected readonly permissionChecker: IPermissionChecker,
  ) {}

  isGranted(name: string, resourceName: string, resourceKey: string): Promise<boolean>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, name: string, resourceName: string, resourceKey: string): Promise<boolean>;
  isGranted(names: readonly string[], resourceName: string, resourceKey: string): Promise<MultiplePermissionGrantResult>;
  isGranted(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[], resourceName: string, resourceKey: string): Promise<MultiplePermissionGrantResult>;
  isGranted(...args: ResourceIsGrantedArgs): Promise<boolean | MultiplePermissionGrantResult> {
    const [resourceName, resourceKey] = args.length === 3 ? [args[1], args[2]] : [args[2], args[3]];
    const { principal, useCurrent, target } = parseIsGrantedArgs(args.length === 3 ? [args[0] as string] : [args[0], args[1] as string]);
    const claimsPrincipal = useCurrent ? this.principalAccessor.principal : principal;
    return typeof target === "string" ? this.isGrantedFor(claimsPrincipal, target, resourceName, resourceKey) : this.isGrantedManyFor(claimsPrincipal, target, resourceName, resourceKey);
  }

  protected multiTenancySideOf(claimsPrincipal: ClaimsPrincipal | undefined): MultiTenancySides {
    return claimsPrincipal ? getMultiTenancySideOf(claimsPrincipal) : getMultiTenancySide(this.currentTenant);
  }

  protected async isGrantedFor(claimsPrincipal: ClaimsPrincipal | undefined, name: string, resourceName: string, resourceKey: string): Promise<boolean> {
    Check.notNull(name, "name");
    const permission = await this.permissionDefinitionManager.getResourcePermissionOrNull(resourceName, name);
    if (!permission || !permission.isEnabled) return false;
    if (!(await this.stateCheckerManager.isEnabled(permission))) return false;
    if (!hasMultiTenancySide(permission.multiTenancySide, this.multiTenancySideOf(claimsPrincipal))) return false;

    let isGranted = false;
    const context = new ResourcePermissionValueCheckContext(permission, claimsPrincipal, resourceName, resourceKey);
    for (const provider of this.permissionValueProviderManager.valueProviders) {
      if (permission.providers.length > 0 && !permission.providers.includes(provider.name)) continue;
      const result = await provider.check(context);
      if (result === PermissionGrantResult.Granted) isGranted = true;
      else if (result === PermissionGrantResult.Prohibited) return false;
    }
    return isGranted;
  }

  protected async isGrantedManyFor(claimsPrincipal: ClaimsPrincipal | undefined, names: readonly string[], resourceName: string, resourceKey: string): Promise<MultiplePermissionGrantResult> {
    Check.notNull(names, "names");
    const result = new MultiplePermissionGrantResult();
    if (names.length === 0) return result;

    const multiTenancySide = this.multiTenancySideOf(claimsPrincipal);
    const allResourcePermissions = new Map((await this.permissionDefinitionManager.getResourcePermissions()).filter((p) => p.resourceName === resourceName).map((p) => [p.name, p]));
    const pendingStateCheck: PermissionDefinition[] = [];
    const permissionDefinitions: PermissionDefinition[] = [];

    for (const name of names) {
      const permission = allResourcePermissions.get(name);
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

      const multipleResult = await provider.checkMany(new ResourcePermissionValuesCheckContext(permissions, claimsPrincipal, resourceName, resourceKey));
      for (const [name, grant] of multipleResult.result) {
        if (result.result.get(name) !== PermissionGrantResult.Undefined || grant === PermissionGrantResult.Undefined) continue;
        result.result.set(name, grant);
        removeAll(permissionDefinitions, (x) => x.name === name);
      }
      if (result.allGranted || result.allProhibited) break;
    }

    return result;
  }
}

/* Port of `ResourcePermissionCheckerExtensions` + `KeyedObjectResourcePermissionCheckerExtensions`. */
export const ResourcePermissionCheckerExtensions = {
  /** `IsGrantedAsync<TResource>(permissionName, resource, resourceKey?)`: the key defaults to the `IKeyedObject.key`. */
  isGranted(checker: IResourcePermissionChecker, permissionName: string, resource: object, resourceKey?: string): Promise<boolean> {
    Check.notNullOrWhiteSpace(permissionName, "permissionName");
    Check.notNull(resource, "resource");
    return checker.isGranted(permissionName, resourceNameOf(resource), resourceKey ?? keyOf(resource));
  },
};

/** Port of `ResourcePermissionPopulator`: fills `resourcePermissions` of `IHasResourcePermissions` objects. */
@Transient()
export class ResourcePermissionPopulator {
  static readonly inject = [IPermissionDefinitionManager, IResourcePermissionChecker] as const;

  constructor(
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    protected readonly resourcePermissionChecker: IResourcePermissionChecker,
  ) {}

  async populate<TResource extends IHasResourcePermissions>(resources: TResource | readonly TResource[], resourceName: string): Promise<void> {
    Check.notNullOrWhiteSpace(resourceName, "resourceName");
    const list = Array.isArray(resources) ? (resources as readonly TResource[]) : [resources as TResource];
    const resourcePermissions = (await this.permissionDefinitionManager.getResourcePermissions()).filter((x) => x.resourceName === resourceName);
    const names = resourcePermissions.map((x) => x.name);
    for (const resource of list) {
      const resourceKey = getObjectKey(resource);
      if (resourceKey === undefined) throw new AbpException("Resource key can not be null or empty.");
      const results = await this.resourcePermissionChecker.isGranted(names, resourceName, resourceKey);
      resource.resourcePermissions ??= new Map();
      for (const permission of resourcePermissions) resource.resourcePermissions.set(permission.name, results.isGranted(permission.name));
    }
  }
}
