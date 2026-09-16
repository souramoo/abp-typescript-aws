import { AbpException, Check, Singleton, createToken, type Class } from "@abp/core";
import type { ClaimsPrincipal } from "@abp/security";
import { IPermissionChecker } from "./permissions/permission-checker.js";
import { IResourcePermissionChecker, getObjectKey, resourceNameOf } from "./permissions/resources/resource-permissions.js";

/** Port of `Microsoft.AspNetCore.Authorization.IAuthorizationRequirement` (a marker interface). */
export interface IAuthorizationRequirement {
  readonly requirementName: string;
}

/** Port of `AuthorizationPolicy`: every requirement must succeed. */
export class AuthorizationPolicy {
  readonly requirements: readonly IAuthorizationRequirement[];
  constructor(requirements: readonly IAuthorizationRequirement[]) {
    this.requirements = [...Check.notNull(requirements, "requirements")];
  }

  /** Port of `AuthorizationPolicyBuilder.Combine`. */
  static combine(...policies: readonly AuthorizationPolicy[]): AuthorizationPolicy {
    return new AuthorizationPolicy(policies.flatMap((p) => p.requirements));
  }
}

/** Port of `AuthorizationHandlerContext`. */
export class AuthorizationHandlerContext {
  private readonly pending: Set<IAuthorizationRequirement>;
  private failCalled = false;
  private succeedCalled = false;
  readonly failureReasons: string[] = [];

  constructor(
    readonly requirements: readonly IAuthorizationRequirement[],
    readonly user: ClaimsPrincipal,
    readonly resource: unknown,
  ) {
    this.pending = new Set(requirements);
  }

  get pendingRequirements(): readonly IAuthorizationRequirement[] {
    return [...this.pending];
  }
  get hasFailed(): boolean {
    return this.failCalled;
  }
  get hasSucceeded(): boolean {
    return !this.failCalled && this.succeedCalled && this.pending.size === 0;
  }

  fail(reason?: string): void {
    this.failCalled = true;
    if (reason !== undefined) this.failureReasons.push(reason);
  }

  succeed(requirement: IAuthorizationRequirement): void {
    this.succeedCalled = true;
    this.pending.delete(requirement);
  }
}

/** Port of `IAuthorizationHandler`. Register implementations under this token (multiple registrations allowed). */
export interface IAuthorizationHandler {
  handle(context: AuthorizationHandlerContext): Promise<void>;
}
export const IAuthorizationHandler = createToken<IAuthorizationHandler>("IAuthorizationHandler");

export function isAuthorizationHandler<T>(value: T): value is T & IAuthorizationHandler {
  return typeof value === "object" && value !== null && typeof (value as unknown as IAuthorizationHandler).handle === "function";
}

/**
 * Port of `AuthorizationHandler<TRequirement, TResource>`. The requirement class is given to the constructor
 * because generic type arguments are erased; `resourceType` (optional) narrows the resource the same way.
 */
export abstract class AuthorizationHandler<TRequirement extends IAuthorizationRequirement, TResource = unknown> implements IAuthorizationHandler {
  protected constructor(
    private readonly requirementType: Class<TRequirement>,
    private readonly resourceType?: Class<TResource & object>,
  ) {}

  async handle(context: AuthorizationHandlerContext): Promise<void> {
    if (this.resourceType && !(context.resource instanceof this.resourceType)) return;
    for (const requirement of context.requirements) {
      if (requirement instanceof this.requirementType) await this.handleRequirement(context, requirement, context.resource as TResource);
    }
  }

  protected abstract handleRequirement(context: AuthorizationHandlerContext, requirement: TRequirement, resource: TResource): Promise<void>;
}

/** Port of `AuthorizationResult`. */
export class AuthorizationResult {
  private constructor(
    readonly succeeded: boolean,
    readonly failure?: AuthorizationFailure,
  ) {}

  static success(): AuthorizationResult {
    return new AuthorizationResult(true);
  }
  static failed(failure?: AuthorizationFailure): AuthorizationResult {
    return new AuthorizationResult(false, failure ?? AuthorizationFailure.explicitFail());
  }
}

/** Port of `AuthorizationFailure`. */
export class AuthorizationFailure {
  private constructor(
    readonly failCalled: boolean,
    readonly failedRequirements: readonly IAuthorizationRequirement[],
    readonly failureReasons: readonly string[] = [],
  ) {}

  static explicitFail(reasons: readonly string[] = []): AuthorizationFailure {
    return new AuthorizationFailure(true, [], reasons);
  }
  static failed(failedRequirements: readonly IAuthorizationRequirement[]): AuthorizationFailure {
    return new AuthorizationFailure(false, failedRequirements);
  }
}

/** Port of `DenyAnonymousAuthorizationRequirement` (`RequireAuthenticatedUser`), the default policy of `[Authorize]`. */
export class DenyAnonymousAuthorizationRequirement implements IAuthorizationRequirement, IAuthorizationHandler {
  readonly requirementName = "DenyAnonymousAuthorizationRequirement";
  async handle(context: AuthorizationHandlerContext): Promise<void> {
    if (context.user.isAuthenticated) context.succeed(this);
  }
}

/** Port of `RolesAuthorizationRequirement` (`[Authorize(Roles = "a,b")]`). */
export class RolesAuthorizationRequirement implements IAuthorizationRequirement, IAuthorizationHandler {
  readonly requirementName = "RolesAuthorizationRequirement";
  readonly allowedRoles: readonly string[];
  constructor(allowedRoles: readonly string[]) {
    this.allowedRoles = Check.notNullOrEmptyArray(allowedRoles, "allowedRoles");
  }
  async handle(context: AuthorizationHandlerContext): Promise<void> {
    if (this.allowedRoles.some((role) => context.user.isInRole(role))) context.succeed(this);
  }
}

/** Port of `AssertionRequirement` (`policy.RequireAssertion(context => ...)`): a custom policy handler. */
export class AssertionRequirement implements IAuthorizationRequirement, IAuthorizationHandler {
  readonly requirementName = "AssertionRequirement";
  constructor(readonly handler: (context: AuthorizationHandlerContext) => boolean | Promise<boolean>) {
    Check.notNull(handler, "handler");
  }
  async handle(context: AuthorizationHandlerContext): Promise<void> {
    if (await this.handler(context)) context.succeed(this);
  }
}

/** Port of `PermissionRequirement`. */
export class PermissionRequirement implements IAuthorizationRequirement {
  readonly requirementName = "PermissionRequirement";
  constructor(readonly permissionName: string) {
    Check.notNull(permissionName, "permissionName");
  }
  toString(): string {
    return `PermissionRequirement: ${this.permissionName}`;
  }
}

/** Port of `PermissionsRequirement`. */
export class PermissionsRequirement implements IAuthorizationRequirement {
  readonly requirementName = "PermissionsRequirement";
  constructor(
    readonly permissionNames: readonly string[],
    readonly requiresAll: boolean,
  ) {
    Check.notNull(permissionNames, "permissionNames");
  }
  toString(): string {
    return `PermissionsRequirement: ${this.permissionNames.join(", ")}`;
  }
}

/** Port of `ResourcePermissionRequirement`. */
export class ResourcePermissionRequirement implements IAuthorizationRequirement {
  readonly requirementName = "ResourcePermissionRequirement";
  constructor(readonly permissionName: string) {
    Check.notNull(permissionName, "permissionName");
  }
  toString(): string {
    return `ResourcePermissionRequirement: ${this.permissionName}`;
  }
}

/** Port of `PermissionRequirementHandler`. */
@Singleton(IAuthorizationHandler)
export class PermissionRequirementHandler extends AuthorizationHandler<PermissionRequirement> {
  static readonly inject = [IPermissionChecker] as const;
  constructor(private readonly permissionChecker: IPermissionChecker) {
    super(PermissionRequirement);
  }
  protected async handleRequirement(context: AuthorizationHandlerContext, requirement: PermissionRequirement): Promise<void> {
    if (await this.permissionChecker.isGranted(context.user, requirement.permissionName)) context.succeed(requirement);
  }
}

/** Port of `PermissionsRequirementHandler`. */
@Singleton(IAuthorizationHandler)
export class PermissionsRequirementHandler extends AuthorizationHandler<PermissionsRequirement> {
  static readonly inject = [IPermissionChecker] as const;
  constructor(private readonly permissionChecker: IPermissionChecker) {
    super(PermissionsRequirement);
  }
  protected async handleRequirement(context: AuthorizationHandlerContext, requirement: PermissionsRequirement): Promise<void> {
    const result = await this.permissionChecker.isGranted(context.user, requirement.permissionNames);
    const granted = requirement.requiresAll ? result.allGranted : requirement.permissionNames.some((name) => result.isGranted(name));
    if (granted) context.succeed(requirement);
  }
}

/** Port of `KeyedObjectResourcePermissionRequirementHandler`: the resource is any object with a `key`. */
@Singleton(IAuthorizationHandler)
export class KeyedObjectResourcePermissionRequirementHandler extends AuthorizationHandler<ResourcePermissionRequirement> {
  static readonly inject = [IResourcePermissionChecker] as const;
  constructor(protected readonly permissionChecker: IResourcePermissionChecker) {
    super(ResourcePermissionRequirement);
  }
  protected async handleRequirement(context: AuthorizationHandlerContext, requirement: ResourcePermissionRequirement, resource: unknown): Promise<void> {
    if (typeof resource !== "object" || resource === null || !("key" in resource)) return;
    const resourceKey = getObjectKey(resource as { key: string });
    if (resourceKey === undefined) throw new AbpException("The resource doesn't have a key.");
    if (await this.permissionChecker.isGranted(context.user, requirement.permissionName, resourceNameOf(resource), resourceKey)) context.succeed(requirement);
  }
}

export type PolicyAssertion = (context: AuthorizationHandlerContext) => boolean | Promise<boolean>;

/**
 * Port of `Microsoft.AspNetCore.Authorization.AuthorizationOptions`: named policies registered by the application.
 * A policy name that is not registered here is treated as a permission name by `AbpAuthorizationPolicyProvider`.
 */
export class AbpAuthorizationOptions {
  private readonly policyMap = new Map<string, AuthorizationPolicy>();
  /** Policy applied by `@Authorize()` without a policy name: requires an authenticated user. */
  defaultPolicy = new AuthorizationPolicy([new DenyAnonymousAuthorizationRequirement()]);
  /** Policy applied when no `@Authorize()` metadata exists at all (none by default). */
  fallbackPolicy: AuthorizationPolicy | undefined;
  invokeHandlersAfterFailure = true;

  get policies(): ReadonlyMap<string, AuthorizationPolicy> {
    return this.policyMap;
  }

  /** `options.AddPolicy(name, policy)` or `options.AddPolicy(name, builder => builder.RequireAssertion(...))`. */
  addPolicy(name: string, policy: AuthorizationPolicy | readonly IAuthorizationRequirement[] | PolicyAssertion): this {
    Check.notNullOrWhiteSpace(name, "name");
    const value = policy instanceof AuthorizationPolicy ? policy : typeof policy === "function" ? new AuthorizationPolicy([new AssertionRequirement(policy)]) : new AuthorizationPolicy(policy);
    this.policyMap.set(name, value);
    return this;
  }

  getPolicy(name: string): AuthorizationPolicy | undefined {
    return this.policyMap.get(Check.notNull(name, "name"));
  }

  /** Port of `AuthorizationOptionsExtensions.GetPoliciesNames`. */
  getPoliciesNames(): string[] {
    return [...this.policyMap.keys()];
  }
}
