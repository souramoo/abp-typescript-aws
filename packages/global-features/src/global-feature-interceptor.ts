import { AbpCrossCuttingConcerns, AbpInterceptor, AppliedCrossCuttingConcerns, Transient, formatNamed, type Class, type IAbpMethodInvocation, type IOnServiceRegisteredContext } from "@abp/core";
import { AbpAuthorizationException } from "@abp/authorization";
import { GlobalFeatureCheckingEnabled, isGlobalFeatureEnabled } from "./global-feature-attributes.js";
import { abpGlobalFeatureEn } from "./localization/abp-global-feature-resource.js";

/** Port of `AbpGlobalFeatureErrorCodes`. */
export const AbpGlobalFeatureErrorCodes = {
  GlobalFeatureIsNotEnabled: "Volo.GlobalFeature:010001",
} as const;

/**
 * Port of `AbpGlobalFeatureNotEnabledException`. In .NET it derives from `AbpException`; here it derives from
 * `AbpAuthorizationException` so a disabled global feature is reported as an authorization failure (403).
 */
export class AbpGlobalFeatureNotEnabledException extends AbpAuthorizationException {
  constructor(message?: string, code?: string, cause?: unknown) {
    super(message ?? "Global feature is not enabled!", code, cause);
  }
}

/** Port of `GlobalFeatureInterceptor`. */
@Transient()
export class GlobalFeatureInterceptor extends AbpInterceptor {
  override async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    if (!AppliedCrossCuttingConcerns.isApplied(invocation.targetObject, AbpCrossCuttingConcerns.GlobalFeatureChecking)) {
      const { enabled, featureName } = isGlobalFeatureEnabled(invocation.targetType);
      if (!enabled) throw createGlobalFeatureNotEnabledException(invocation.targetType, featureName!);
    }
    await invocation.proceed();
  }
}

export function createGlobalFeatureNotEnabledException(serviceType: Class, globalFeatureName: string): AbpGlobalFeatureNotEnabledException {
  const data = { ServiceName: serviceType.name, GlobalFeatureName: globalFeatureName };
  const code = AbpGlobalFeatureErrorCodes.GlobalFeatureIsNotEnabled;
  const exception = new AbpGlobalFeatureNotEnabledException(formatNamed(abpGlobalFeatureEn.texts[code] as string, data), code);
  exception.withData("ServiceName", data.ServiceName).withData("GlobalFeatureName", data.GlobalFeatureName);
  return exception;
}

/** Port of `GlobalFeatureInterceptorRegistrar`. */
export const GlobalFeatureInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (GlobalFeatureInterceptorRegistrar.shouldIntercept(context.implementationType)) context.interceptors.tryAdd(GlobalFeatureInterceptor);
  },
  shouldIntercept(type: Class): boolean {
    return GlobalFeatureCheckingEnabled.has(type);
  },
};
