import type { Class } from "@abp/core";

const inherited = new WeakMap<Class, Class[]>();

/** Port of `[InheritResource(typeof(A), typeof(B))]` (an `IInheritedResourceTypesProvider`). */
export function InheritResource(...resourceTypes: Class[]) {
  return <C extends Class>(target: C): void => {
    inherited.set(target, [...(inherited.get(target) ?? []), ...resourceTypes]);
  };
}

export function getInheritedResourceTypes(resourceType: Class): readonly Class[] {
  return inherited.get(resourceType) ?? [];
}
