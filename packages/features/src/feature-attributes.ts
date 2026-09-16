import { createMethodMetadata, getMethodNames, type Class } from "@abp/core";

/** Port of `RequiresFeatureAttribute` data. */
export interface RequiresFeatureData {
  readonly features: readonly string[];
  /** true: all features must be enabled; false (default): at least one. */
  readonly requiresAll: boolean;
}

export interface RequiresFeatureOptions {
  requiresAll?: boolean;
}

const requiresFeatureMetadata = createMethodMetadata<readonly RequiresFeatureData[]>("RequiresFeature");
const disableFeatureCheckMetadata = createMethodMetadata<boolean>("DisableFeatureCheck");

type ClassOrMethodDecorator = (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void;

/**
 * Port of `[RequiresFeature("A", "B", RequiresAll = true)]` on a class or a method:
 * `@RequiresFeature("A", "B", { requiresAll: true })`. May be applied several times; base class and
 * overridden method attributes are inherited, like .NET.
 */
export function RequiresFeature(...args: (string | RequiresFeatureOptions)[]): ClassOrMethodDecorator {
  const features = args.filter((a): a is string => typeof a === "string");
  const options = args.find((a): a is RequiresFeatureOptions => typeof a === "object") ?? {};
  const data: RequiresFeatureData = { features, requiresAll: options.requiresAll ?? false };
  return (target, propertyKey) => {
    if (propertyKey === undefined) {
      const type = target as Class;
      requiresFeatureMetadata.setForClass(type, [...(requiresFeatureMetadata.getForClass(type) ?? []), data]);
      return;
    }
    const type = (target as { constructor: Class }).constructor;
    requiresFeatureMetadata([...(requiresFeatureMetadata.get(type, String(propertyKey)) ?? []), data])(target, propertyKey);
  };
}

/** Port of `[DisableFeatureCheck]` on a method. */
export function DisableFeatureCheck(): (target: object, propertyKey: string | symbol) => void {
  return disableFeatureCheckMetadata(true);
}

export const RequiresFeatureMetadata = {
  getForClass(type: Class | undefined): readonly RequiresFeatureData[] {
    return requiresFeatureMetadata.getForClass(type) ?? [];
  },
  getForMethod(type: Class | undefined, method: string): readonly RequiresFeatureData[] {
    return requiresFeatureMetadata.get(type, method) ?? [];
  },
  isCheckDisabled(type: Class | undefined, method: string): boolean {
    return disableFeatureCheckMetadata.get(type, method) === true;
  },
  /** Port of `FeatureInterceptorRegistrar.ShouldIntercept`: the class or any of its methods is decorated. */
  hasAny(type: Class): boolean {
    return RequiresFeatureMetadata.getForClass(type).length > 0 || getMethodNames(type).some((m) => RequiresFeatureMetadata.getForMethod(type, m).length > 0);
  },
};
