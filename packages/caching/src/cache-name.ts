import { Check, removePostFix, type AbstractClass } from "@abp/core";

const names = new WeakMap<AbstractClass, string>();

/** Port of `[CacheName("...")]` on cache item classes. */
export function CacheName(name: string) {
  Check.notNull(name, "name");
  return (target: AbstractClass): void => {
    names.set(target, name);
  };
}

/** Port of `CacheNameAttribute.GetCacheName`: the decorated name, else the class name without the `CacheItem` postfix. */
export const CacheNameAttribute = {
  getCacheName(cacheItemType: AbstractClass): string {
    let current: unknown = cacheItemType;
    while (typeof current === "function" && current !== Function.prototype) {
      const name = names.get(current as AbstractClass);
      if (name !== undefined) return name;
      current = Object.getPrototypeOf(current);
    }
    return removePostFix(cacheItemType.name, "CacheItem");
  },
};
