import type { Class } from "@abp/core";

const names = new WeakMap<Class, string>();

/**
 * Port of `[LocalizationResourceName("X")]`. Without the attribute ABP falls back to the type's full name;
 * here the fallback is the class name (there is no namespace at runtime).
 */
export function LocalizationResourceName(name: string) {
  return <C extends Class>(target: C): void => {
    names.set(target, name);
  };
}

export const LocalizationResourceNameAttribute = {
  getOrNull(resourceType: Class): string | undefined {
    return names.get(resourceType);
  },
  getName(resourceType: Class): string {
    return names.get(resourceType) ?? resourceType.name;
  },
};

export function getLocalizationResourceName(resourceType: Class): string {
  return LocalizationResourceNameAttribute.getName(resourceType);
}
