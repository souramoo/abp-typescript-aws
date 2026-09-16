import { AbpCrossCuttingConcerns, AbpInterceptor, AppliedCrossCuttingConcerns, IServiceProviderToken, Transient, createToken, type Class, type IAbpMethodInvocation, type IOnServiceRegisteredContext, type IServiceProvider } from "@abp/core";
import { RequiresFeatureMetadata, type RequiresFeatureData } from "./feature-attributes.js";
import { FeatureCheckerExtensions, IFeatureChecker } from "./feature-checker.js";

/** Port of `MethodInvocationFeatureCheckerContext` (`MethodInfo` becomes class + method name). */
export class MethodInvocationFeatureCheckerContext {
  constructor(
    readonly targetType: Class,
    readonly method: string,
  ) {}
}

/** Port of `IMethodInvocationFeatureCheckerService`. */
export interface IMethodInvocationFeatureCheckerService {
  check(context: MethodInvocationFeatureCheckerContext): Promise<void>;
}
export const IMethodInvocationFeatureCheckerService = createToken<IMethodInvocationFeatureCheckerService>("IMethodInvocationFeatureCheckerService");

/** Port of `MethodInvocationFeatureCheckerService`. */
@Transient(IMethodInvocationFeatureCheckerService)
export class MethodInvocationFeatureCheckerService implements IMethodInvocationFeatureCheckerService {
  static readonly inject = [IFeatureChecker] as const;

  constructor(private readonly featureChecker: IFeatureChecker) {}

  async check(context: MethodInvocationFeatureCheckerContext): Promise<void> {
    if (this.isFeatureCheckDisabled(context)) return;
    for (const data of this.getRequiredFeatures(context)) await FeatureCheckerExtensions.checkEnabledMany(this.featureChecker, data.requiresAll, data.features);
  }

  protected isFeatureCheckDisabled(context: MethodInvocationFeatureCheckerContext): boolean {
    return RequiresFeatureMetadata.isCheckDisabled(context.targetType, context.method);
  }

  /** Method-level data first, then class-level data (every TypeScript method is public). */
  protected getRequiredFeatures(context: MethodInvocationFeatureCheckerContext): readonly RequiresFeatureData[] {
    return [...RequiresFeatureMetadata.getForMethod(context.targetType, context.method), ...RequiresFeatureMetadata.getForClass(context.targetType)];
  }
}

/** Port of `FeatureInterceptor`: checks in a fresh service scope, like .NET's `IServiceScopeFactory`. */
@Transient()
export class FeatureInterceptor extends AbpInterceptor {
  static readonly inject = [IServiceProviderToken] as const;

  constructor(private readonly serviceProvider: IServiceProvider) {
    super();
  }

  override async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    if (!AppliedCrossCuttingConcerns.isApplied(invocation.targetObject, AbpCrossCuttingConcerns.FeatureChecking)) await this.checkFeatures(invocation);
    await invocation.proceed();
  }

  protected async checkFeatures(invocation: IAbpMethodInvocation): Promise<void> {
    await using scope = this.serviceProvider.createScope();
    await scope.serviceProvider.getRequired(IMethodInvocationFeatureCheckerService).check(new MethodInvocationFeatureCheckerContext(invocation.targetType, invocation.method));
  }
}

/** Port of `FeatureInterceptorRegistrar`. */
export const FeatureInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (FeatureInterceptorRegistrar.shouldIntercept(context.implementationType)) context.interceptors.tryAdd(FeatureInterceptor);
  },
  shouldIntercept(type: Class): boolean {
    return RequiresFeatureMetadata.hasAny(type);
  },
};
