import { Check, type Class, type IServiceProvider } from "@abp/core";
import type { ExtensionPropertyType } from "./extension-property-helper.js";
import { ObjectExtensionInfo, type ConfigurePropertyAction } from "./object-extension-info.js";
import type { ObjectExtensionPropertyInfo } from "./object-extension-property-info.js";
import { ExtensionPropertyPolicyChecker } from "./extension-property-policy-checker.js";

export type ConfigureExtensionAction = (extension: ObjectExtensionInfo) => void;

/** Port of `ObjectExtensionManager` (+ `ObjectExtensionManagerExtensions` as instance methods). */
export class ObjectExtensionManager {
  static instance = new ObjectExtensionManager();

  readonly configuration = new Map<unknown, unknown>();
  protected readonly objectsExtensions = new Map<Class, ObjectExtensionInfo>();

  addOrUpdate(type: Class | readonly Class[], configureAction?: ConfigureExtensionAction): this {
    for (const t of Array.isArray(type) ? (type as readonly Class[]) : [type as Class]) {
      let extensionInfo = this.objectsExtensions.get(t);
      if (!extensionInfo) {
        extensionInfo = new ObjectExtensionInfo(t);
        this.objectsExtensions.set(t, extensionInfo);
      }
      configureAction?.(extensionInfo);
    }
    return this;
  }

  addOrUpdateProperty(objectType: Class | readonly Class[], propertyType: ExtensionPropertyType, propertyName: string, configureAction?: ConfigurePropertyAction): this {
    return this.addOrUpdate(objectType, (extension) => {
      extension.addOrUpdateProperty(propertyType, propertyName, configureAction);
    });
  }

  getOrNull(type: Class): ObjectExtensionInfo | undefined {
    return this.objectsExtensions.get(type);
  }

  getExtendedObjects(): readonly ObjectExtensionInfo[] {
    return [...this.objectsExtensions.values()];
  }

  getPropertyOrNull(objectType: Class, propertyName: string): ObjectExtensionPropertyInfo | undefined {
    Check.notNull(objectType, "objectType");
    Check.notNull(propertyName, "propertyName");
    return this.getOrNull(objectType)?.getPropertyOrNull(propertyName);
  }

  getProperties(objectType: Class): readonly ObjectExtensionPropertyInfo[] {
    Check.notNull(objectType, "objectType");
    return this.getOrNull(objectType)?.getProperties() ?? [];
  }

  async getPropertiesAndCheckPolicyAsync(objectType: Class, serviceProvider: IServiceProvider): Promise<readonly ObjectExtensionPropertyInfo[]> {
    const checker = serviceProvider.getRequired(ExtensionPropertyPolicyChecker);
    const properties: ObjectExtensionPropertyInfo[] = [];
    for (const property of this.getProperties(objectType)) {
      if (await checker.checkPolicyAsync(property.policy)) properties.push(property);
    }
    return properties;
  }
}
