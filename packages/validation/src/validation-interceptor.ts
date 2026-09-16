import { AbpInterceptor, AppliedCrossCuttingConcerns, Transient, type IAbpMethodInvocation, type IOnServiceRegisteredContext } from "@abp/core";
import { IMethodInvocationValidator, MethodInvocationValidationContext } from "./method-invocation-validator.js";
import { ValidationEnabled } from "./validation-attributes.js";

/** Port of `AbpCrossCuttingConcerns` for this package. */
export const AbpCrossCuttingConcerns = {
  Validation: "AbpValidation",
} as const;

/** Port of `ValidationInterceptor`: validates the arguments of every intercepted method before it runs. */
@Transient()
export class ValidationInterceptor extends AbpInterceptor {
  static readonly inject = [IMethodInvocationValidator] as const;
  constructor(private readonly methodInvocationValidator: IMethodInvocationValidator) {
    super();
  }

  override async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    if (AppliedCrossCuttingConcerns.isApplied(invocation.targetObject, AbpCrossCuttingConcerns.Validation)) {
      await invocation.proceed();
      return;
    }
    using _ = AppliedCrossCuttingConcerns.apply(invocation.targetObject, AbpCrossCuttingConcerns.Validation);
    await this.validateAsync(invocation);
    await invocation.proceed();
  }

  protected async validateAsync(invocation: IAbpMethodInvocation): Promise<void> {
    await this.methodInvocationValidator.validateAsync(new MethodInvocationValidationContext(invocation.targetObject, invocation.targetType, invocation.method, invocation.args));
  }
}

/** Port of `ValidationInterceptorRegistrar`. */
export const ValidationInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (ValidationInterceptorRegistrar.shouldIntercept(context.implementationType)) context.interceptors.tryAdd(ValidationInterceptor);
  },
  shouldIntercept(type: IOnServiceRegisteredContext["implementationType"]): boolean {
    return ValidationEnabled.has(type);
  },
};
