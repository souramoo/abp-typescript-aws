import { Check, type ILocalizableString } from "@abp/core";
import type { z } from "zod";
import { ExtensionPropertyLookupConfiguration, createExtensionPropertyPolicy, createExtensionPropertyUI, type ExtensionPropertyPolicyConfiguration, type ExtensionPropertyUI } from "./extension-property-configurations.js";
import { ExtensionPropertyHelper, type ExtensionPropertyType } from "./extension-property-helper.js";
import type { ObjectExtensionInfo } from "./object-extension-info.js";
import type { ObjectExtensionPropertyValidationContext } from "./object-extension-validation-context.js";

/** Port of `IBasicObjectExtensionPropertyInfo`. */
export interface IBasicObjectExtensionPropertyInfo {
  readonly name: string;
  type: ExtensionPropertyType;
  readonly validators: ((context: ObjectExtensionPropertyValidationContext) => void)[];
  readonly displayName: ILocalizableString | undefined;
  defaultValue: unknown;
  defaultValueFactory: (() => unknown) | undefined;
}

/**
 * Port of `ObjectExtensionPropertyInfo`. `Attributes` (DataAnnotations) are replaced by the zod schema of `type`;
 * custom `validators` are kept as in ABP. `type` is mutable so `addOrUpdateProperty(name, p => { p.type = … })` works.
 */
export class ObjectExtensionPropertyInfo implements IBasicObjectExtensionPropertyInfo {
  readonly objectExtension: ObjectExtensionInfo;
  readonly name: string;
  type: ExtensionPropertyType;
  readonly validators: ((context: ObjectExtensionPropertyValidationContext) => void)[] = [];
  displayName: ILocalizableString | undefined;
  /** Whether mapping requires the other side to define the property too (`undefined` = default logic). */
  checkPairDefinitionOnMapping: boolean | undefined;
  readonly configuration = new Map<unknown, unknown>();
  defaultValue: unknown;
  defaultValueFactory: (() => unknown) | undefined;
  lookup = new ExtensionPropertyLookupConfiguration();
  ui: ExtensionPropertyUI = createExtensionPropertyUI();
  policy: ExtensionPropertyPolicyConfiguration = createExtensionPropertyPolicy();

  constructor(objectExtension: ObjectExtensionInfo, type: ExtensionPropertyType, name: string) {
    this.objectExtension = Check.notNull(objectExtension, "objectExtension");
    this.type = Check.notNull(type, "type");
    this.name = Check.notNull(name, "name");
    this.defaultValue = ExtensionPropertyHelper.getTypeDefaultValue(type);
  }

  getDefaultValue(): unknown {
    return ExtensionPropertyHelper.getDefaultValue(this.type, this.defaultValueFactory, this.defaultValue);
  }

  /** Port of `GetValidationAttributes()`: the schema that validates a value of this property. */
  getSchema(): z.ZodType {
    return ExtensionPropertyHelper.toSchema(this.type);
  }
}
