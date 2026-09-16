import { Check, type AbstractClass } from "@abp/core";

const names = new WeakMap<AbstractClass, string>();

/** Port of `[BackgroundWorkerName("...")]`. */
export function BackgroundWorkerName(name: string) {
  Check.notNullOrWhiteSpace(name, "name");
  return (target: AbstractClass): void => {
    names.set(target, name);
  };
}

/** Port of `BackgroundWorkerNameAttribute` static helpers; the default name is the class name. */
export const BackgroundWorkerNameAttribute = {
  getName(workerType: AbstractClass): string {
    Check.notNull(workerType, "workerType");
    return BackgroundWorkerNameAttribute.getNameOrNull(workerType) ?? workerType.name;
  },
  getNameOrNull(workerType: AbstractClass): string | undefined {
    let current: unknown = workerType;
    while (typeof current === "function" && current !== Function.prototype) {
      const name = names.get(current as AbstractClass);
      if (name !== undefined) return name;
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  },
};
