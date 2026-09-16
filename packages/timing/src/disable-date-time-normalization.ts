import { type Class, createClassMarker, isClass } from "@abp/core";

const classMarker = createClassMarker("DisableDateTimeNormalization");
const properties = new WeakMap<object, Set<string>>();

function decorate(target: object, propertyKey?: string | symbol): void {
  if (propertyKey === undefined) {
    if (isClass(target)) classMarker.mark(target);
    return;
  }
  let set = properties.get(target);
  if (!set) {
    set = new Set();
    properties.set(target, set);
  }
  set.add(String(propertyKey));
}

/** Port of `[DisableDateTimeNormalization]`: usable on a class or on a property. */
export function DisableDateTimeNormalization(): (target: object, propertyKey?: string | symbol) => void {
  return decorate;
}

DisableDateTimeNormalization.isDisabled = (type: Class | undefined, propertyName?: string): boolean => {
  if (classMarker.has(type)) return true;
  if (propertyName === undefined) return false;
  let proto: unknown = type?.prototype;
  while (proto && proto !== Object.prototype) {
    if (properties.get(proto as object)?.has(propertyName)) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
};
