import { Check, type Class } from "@abp/core";
import { z } from "zod";
import type { ExtensionPropertyType } from "./extension-property-helper.js";
import { ObjectExtensionPropertyInfo } from "./object-extension-property-info.js";
import type { ObjectExtensionValidationContext } from "./object-extension-validation-context.js";

export type ConfigurePropertyAction = (property: ObjectExtensionPropertyInfo) => void;

/** Port of `ObjectExtensionInfo`: the extension properties defined for one class. */
export class ObjectExtensionInfo {
  readonly type: Class;
  protected readonly properties = new Map<string, ObjectExtensionPropertyInfo>();
  readonly configuration = new Map<unknown, unknown>();
  readonly validators: ((context: ObjectExtensionValidationContext) => void)[] = [];

  constructor(type: Class) {
    this.type = Check.notNull(type, "type");
  }

  hasProperty(propertyName: string): boolean {
    return this.properties.has(propertyName);
  }

  /**
   * `AddOrUpdateProperty(propertyType, propertyName, configure)` as in ABP, or `(propertyName, configure)` which
   * leaves the type as `z.unknown()` unless `configure` sets it. The type of an existing property is kept.
   */
  addOrUpdateProperty(propertyType: ExtensionPropertyType, propertyName: string, configureAction?: ConfigurePropertyAction): this;
  addOrUpdateProperty(propertyName: string, configureAction?: ConfigurePropertyAction): this;
  addOrUpdateProperty(typeOrName: ExtensionPropertyType | string, nameOrConfigure?: string | ConfigurePropertyAction, configureAction?: ConfigurePropertyAction): this {
    const explicitType = typeof nameOrConfigure === "string";
    const propertyName = explicitType ? nameOrConfigure : (typeOrName as string);
    const propertyType: ExtensionPropertyType = explicitType ? (typeOrName as ExtensionPropertyType) : z.unknown();
    const configure = explicitType ? configureAction : (nameOrConfigure as ConfigurePropertyAction | undefined);
    Check.notNull(propertyName, "propertyName");

    let propertyInfo = this.properties.get(propertyName);
    if (!propertyInfo) {
      propertyInfo = new ObjectExtensionPropertyInfo(this, propertyType, propertyName);
      this.properties.set(propertyName, propertyInfo);
    }
    configure?.(propertyInfo);
    return this;
  }

  getProperties(): readonly ObjectExtensionPropertyInfo[] {
    return [...this.properties.values()].sort((a, b) => a.ui.order - b.ui.order);
  }

  getPropertyOrNull(propertyName: string): ObjectExtensionPropertyInfo | undefined {
    Check.notNullOrEmpty(propertyName, "propertyName");
    return this.properties.get(propertyName);
  }
}
