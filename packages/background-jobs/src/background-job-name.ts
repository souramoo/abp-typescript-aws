import { Check, type AbstractClass } from "@abp/core";

const names = new WeakMap<AbstractClass, string>();

/** Port of `[BackgroundJobName("...")]` on job args classes. */
export function BackgroundJobName(name: string) {
  Check.notNullOrWhiteSpace(name, "name");
  return (target: AbstractClass): void => {
    names.set(target, name);
  };
}

/** Port of `BackgroundJobNameAttribute.GetName`: the decorated name, else the args class name. */
export const BackgroundJobNameAttribute = {
  getName(jobArgsType: AbstractClass): string {
    Check.notNull(jobArgsType, "jobArgsType");
    let current: unknown = jobArgsType;
    while (typeof current === "function" && current !== Function.prototype) {
      const name = names.get(current as AbstractClass);
      if (name !== undefined) return name;
      current = Object.getPrototypeOf(current);
    }
    return jobArgsType.name;
  },
};
