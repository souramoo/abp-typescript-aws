import { Check, type AbstractClass } from "@abp/core";

const names = new WeakMap<AbstractClass, string>();

/** Port of `[BlobContainerName("...")]`. */
export function BlobContainerName(name: string) {
  Check.notNullOrWhiteSpace(name, "name");
  return (target: AbstractClass): void => {
    names.set(target, name);
  };
}

/** Port of `BlobContainerNameAttribute.GetContainerName`: the decorated name, else the class name. */
export const BlobContainerNameAttribute = {
  getContainerName(type: AbstractClass): string {
    let current: unknown = type;
    while (typeof current === "function" && current !== Function.prototype) {
      const name = names.get(current as AbstractClass);
      if (name !== undefined) return name;
      current = Object.getPrototypeOf(current);
    }
    return type.name;
  },
};

/** Port of `DefaultContainer`. */
@BlobContainerName("default")
export class DefaultContainer {
  static readonly Name = "default";
}
