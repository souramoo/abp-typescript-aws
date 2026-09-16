import { AbpException, Check, Dependency, IServiceProviderToken, ServiceLifetime, createToken, formatNamed, optionsToken, type Class, type IOptions, type IServiceProvider, type IServiceProviderAccessor, type ServiceCollection } from "@abp/core";
import { AbpAuthorizationException, ICurrentPrincipalAccessor, type ClaimsPrincipal } from "@abp/security";
import { IAbpAuthorizationPolicyProvider } from "./abp-authorization-policy-provider.js";
import { AbpAuthorizationOptions, AuthorizationFailure, AuthorizationHandlerContext, AuthorizationPolicy, AuthorizationResult, IAuthorizationHandler, isAuthorizationHandler, type IAuthorizationRequirement } from "./authorization-requirements.js";
import { abpAuthorizationEn } from "./localization/abp-authorization-resource.js";
import { AlwaysAllowPermissionChecker, IPermissionChecker } from "./permissions/permission-checker.js";

/** Port of `AbpAuthorizationErrorCodes`. */
export const AbpAuthorizationErrorCodes = {
  GivenPolicyHasNotGranted: "Volo.Authorization:010001",
  GivenPolicyHasNotGrantedWithPolicyName: "Volo.Authorization:010002",
  GivenPolicyHasNotGrantedForGivenResource: "Volo.Authorization:010003",
  GivenRequirementHasNotGrantedForGivenResource: "Volo.Authorization:010004",
  GivenRequirementsHasNotGrantedForGivenResource: "Volo.Authorization:010005",
} as const;

/** What `AuthorizeAsync` accepts in place of ASP.NET Core's `policyName` / `policy` / `requirement(s)` overloads. */
export type AuthorizationTarget = string | AuthorizationPolicy | IAuthorizationRequirement | readonly IAuthorizationRequirement[];

/**
 * Port of `IAbpAuthorizationService` (`IAuthorizationService` + `CurrentPrincipal`). The `AuthorizeAsync` /
 * `IsGrantedAsync` / `CheckAsync` extension methods of `AbpAuthorizationServiceExtensions` are members here.
 */
export interface IAbpAuthorizationService extends IServiceProviderAccessor {
  readonly currentPrincipal: ClaimsPrincipal;
  /** `AuthorizeAsync(user, resource, policyName | requirements)`. */
  authorizeUser(user: ClaimsPrincipal, resource: unknown, target: AuthorizationTarget): Promise<AuthorizationResult>;
  /** `AuthorizeAsync(policyName)` and friends for the current principal. */
  authorize(target: AuthorizationTarget, resource?: unknown): Promise<AuthorizationResult>;
  isGranted(target: AuthorizationTarget, resource?: unknown): Promise<boolean>;
  isGrantedAny(...policyNames: string[]): Promise<boolean>;
  /** Throws `AbpAuthorizationException` (with the matching `AbpAuthorizationErrorCodes` code) when not granted. */
  check(target: AuthorizationTarget, resource?: unknown): Promise<void>;
}
export const IAbpAuthorizationService = createToken<IAbpAuthorizationService>("IAbpAuthorizationService");

/** Shared implementation of the extension-method members on top of `authorizeUser`. */
export abstract class AbpAuthorizationServiceBase implements IAbpAuthorizationService {
  abstract readonly serviceProvider: IServiceProvider;
  abstract readonly currentPrincipal: ClaimsPrincipal;
  abstract authorizeUser(user: ClaimsPrincipal, resource: unknown, target: AuthorizationTarget): Promise<AuthorizationResult>;

  authorize(target: AuthorizationTarget, resource?: unknown): Promise<AuthorizationResult> {
    return this.authorizeUser(this.currentPrincipal, resource, target);
  }

  async isGranted(target: AuthorizationTarget, resource?: unknown): Promise<boolean> {
    return (await this.authorize(target, resource)).succeeded;
  }

  async isGrantedAny(...policyNames: string[]): Promise<boolean> {
    Check.notNullOrEmptyArray(policyNames, "policyNames");
    for (const policyName of policyNames) if (await this.isGranted(policyName)) return true;
    return false;
  }

  async check(target: AuthorizationTarget, resource?: unknown): Promise<void> {
    if (await this.isGranted(target, resource)) return;
    throw createAuthorizationException(target, resource);
  }
}

function createAuthorizationException(target: AuthorizationTarget, resource: unknown): AbpAuthorizationException {
  const hasResource = resource !== undefined && resource !== null;
  const [code, data] =
    typeof target === "string"
      ? hasResource
        ? [AbpAuthorizationErrorCodes.GivenPolicyHasNotGrantedForGivenResource, { ResourceName: resource }]
        : [AbpAuthorizationErrorCodes.GivenPolicyHasNotGrantedWithPolicyName, { PolicyName: target }]
      : target instanceof AuthorizationPolicy
        ? hasResource
          ? [AbpAuthorizationErrorCodes.GivenPolicyHasNotGrantedForGivenResource, { ResourceName: resource }]
          : [AbpAuthorizationErrorCodes.GivenPolicyHasNotGranted, {}]
        : Array.isArray(target)
          ? [AbpAuthorizationErrorCodes.GivenRequirementsHasNotGrantedForGivenResource, { ResourceName: resource }]
          : [AbpAuthorizationErrorCodes.GivenRequirementHasNotGrantedForGivenResource, { ResourceName: resource }];
  const exception = new AbpAuthorizationException(formatNamed(abpAuthorizationEn.texts[code] as string, stringify(data)), code);
  for (const [name, value] of Object.entries(data)) exception.withData(name, value);
  return exception;
}

function stringify(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "object" && v !== null ? (v.constructor.name ?? String(v)) : String(v)]));
}

/**
 * Port of `AbpAuthorizationService` (+ the `DefaultAuthorizationService` it extends): resolves the policy,
 * runs every registered `IAuthorizationHandler` (and self-handling requirements) and evaluates the context.
 */
@Dependency({ lifetime: ServiceLifetime.Transient, exposes: [IAbpAuthorizationService], replaceServices: true })
export class AbpAuthorizationService extends AbpAuthorizationServiceBase {
  static readonly inject = [IAbpAuthorizationPolicyProvider, optionsToken(AbpAuthorizationOptions), ICurrentPrincipalAccessor, IServiceProviderToken] as const;
  private readonly options: AbpAuthorizationOptions;

  constructor(
    private readonly policyProvider: IAbpAuthorizationPolicyProvider,
    options: IOptions<AbpAuthorizationOptions>,
    private readonly currentPrincipalAccessor: ICurrentPrincipalAccessor,
    readonly serviceProvider: IServiceProvider,
  ) {
    super();
    this.options = options.value;
  }

  get currentPrincipal(): ClaimsPrincipal {
    return this.currentPrincipalAccessor.principal;
  }

  async authorizeUser(user: ClaimsPrincipal, resource: unknown, target: AuthorizationTarget): Promise<AuthorizationResult> {
    const requirements = await this.resolveRequirements(target);
    const context = new AuthorizationHandlerContext(requirements, user, resource);
    const handlers: IAuthorizationHandler[] = [...this.serviceProvider.getAll(IAuthorizationHandler), ...requirements.filter(isAuthorizationHandler)];
    for (const handler of handlers) {
      await handler.handle(context);
      if (!this.options.invokeHandlersAfterFailure && context.hasFailed) break;
    }
    if (context.hasSucceeded) return AuthorizationResult.success();
    return AuthorizationResult.failed(context.hasFailed ? AuthorizationFailure.explicitFail(context.failureReasons) : AuthorizationFailure.failed(context.pendingRequirements));
  }

  private async resolveRequirements(target: AuthorizationTarget): Promise<readonly IAuthorizationRequirement[]> {
    if (typeof target === "string") {
      const policy = await this.policyProvider.getPolicy(target);
      if (!policy) throw new AbpException(`No policy found: ${target}.`);
      return policy.requirements;
    }
    if (target instanceof AuthorizationPolicy) return target.requirements;
    return Array.isArray(target) ? (target as readonly IAuthorizationRequirement[]) : [target as IAuthorizationRequirement];
  }
}

/** Port of `AlwaysAllowAuthorizationService`. */
export class AlwaysAllowAuthorizationService extends AbpAuthorizationServiceBase {
  static readonly inject = [IServiceProviderToken, ICurrentPrincipalAccessor] as const;

  constructor(
    readonly serviceProvider: IServiceProvider,
    private readonly currentPrincipalAccessor: ICurrentPrincipalAccessor,
  ) {
    super();
  }

  get currentPrincipal(): ClaimsPrincipal {
    return this.currentPrincipalAccessor.principal;
  }

  async authorizeUser(): Promise<AuthorizationResult> {
    return AuthorizationResult.success();
  }
}

/** Port of `IMethodInvocationAuthorizationService`. */
export interface IMethodInvocationAuthorizationService {
  check(context: MethodInvocationAuthorizationContext): Promise<void>;
}
export const IMethodInvocationAuthorizationService = createToken<IMethodInvocationAuthorizationService>("IMethodInvocationAuthorizationService");

/** Port of `MethodInvocationAuthorizationContext` (`MethodInfo` becomes class + method name). */
export class MethodInvocationAuthorizationContext {
  constructor(
    readonly targetType: Class,
    readonly method: string,
  ) {}
}

/** Port of `AlwaysAllowMethodInvocationAuthorizationService`. */
export class AlwaysAllowMethodInvocationAuthorizationService implements IMethodInvocationAuthorizationService {
  async check(): Promise<void> {}
}

/** Port of `AbpAuthorizationServiceCollectionExtensions.AddAlwaysAllowAuthorization` (useful for tests). */
export function addAlwaysAllowAuthorization(services: ServiceCollection): ServiceCollection {
  services.replaceSingleton(IAbpAuthorizationService, AlwaysAllowAuthorizationService);
  services.replaceSingleton(IMethodInvocationAuthorizationService, AlwaysAllowMethodInvocationAuthorizationService);
  services.replaceSingleton(IPermissionChecker, AlwaysAllowPermissionChecker);
  return services;
}
