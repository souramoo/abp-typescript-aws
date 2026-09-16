import { AbpCrossCuttingConcerns, AbpInterceptor, AppliedCrossCuttingConcerns, Transient, type IAbpMethodInvocation, type IOnServiceRegisteredContext } from "@abp/core";
import { IMethodInvocationAuthorizationService, MethodInvocationAuthorizationContext } from "./abp-authorization-service.js";
import { AuthorizeMetadata } from "./authorize-attributes.js";

/**
 * Port of `AuthorizationInterceptor`. Skips the check when `AbpCrossCuttingConcerns.Authorization` was already
 * applied to the target (e.g. by an HTTP layer that authorized the request itself).
 */
@Transient()
export class AuthorizationInterceptor extends AbpInterceptor {
  static readonly inject = [IMethodInvocationAuthorizationService] as const;

  constructor(private readonly methodInvocationAuthorizationService: IMethodInvocationAuthorizationService) {
    super();
  }

  override async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    if (!AppliedCrossCuttingConcerns.isApplied(invocation.targetObject, AbpCrossCuttingConcerns.Authorization)) await this.authorize(invocation);
    await invocation.proceed();
  }

  protected async authorize(invocation: IAbpMethodInvocation): Promise<void> {
    await this.methodInvocationAuthorizationService.check(new MethodInvocationAuthorizationContext(invocation.targetType, invocation.method));
  }
}

/** Port of `AuthorizationInterceptorRegistrar`. */
export const AuthorizationInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (AuthorizationInterceptorRegistrar.shouldIntercept(context.implementationType)) context.interceptors.tryAdd(AuthorizationInterceptor);
  },
  shouldIntercept(type: IOnServiceRegisteredContext["implementationType"]): boolean {
    return AuthorizeMetadata.hasAny(type);
  },
};
