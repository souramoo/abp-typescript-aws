import { ArgumentException, type Class } from "@abp/core";
import type { z } from "zod";
import { ExtensibleObjectValidator } from "../extensible-object-validator.js";
import { ObjectExtensionManager } from "../object-extension-manager.js";
import { ExtraPropertyDictionary } from "./extra-property-dictionary.js";

/** Port of `IHasExtraProperties`. */
export interface IHasExtraProperties {
  readonly extraProperties: ExtraPropertyDictionary;
}

export function hasExtraProperties(value: unknown): value is IHasExtraProperties {
  return typeof value === "object" && value !== null && "extraProperties" in value && value.extraProperties instanceof ExtraPropertyDictionary;
}

/** Port of `HasExtraPropertiesExtensions` as free functions (`source.HasProperty(name)` → `hasProperty(source, name)`). */
export function hasProperty(source: IHasExtraProperties, name: string): boolean {
  return source.extraProperties.has(name);
}

export function getProperty(source: IHasExtraProperties, name: string, defaultValue?: unknown): unknown {
  return source.extraProperties.get(name) ?? defaultValue;
}

/** Port of `GetProperty<TProperty>` where `TypeHelper.ChangeTypePrimitiveExtended` becomes a zod parse. */
export function getPropertyAs<T>(source: IHasExtraProperties, name: string, schema: z.ZodType<T>, defaultValue?: T): T | undefined {
  const value = getProperty(source, name, defaultValue);
  if (value === null || value === undefined) return defaultValue;
  return schema.parse(value) ?? defaultValue;
}

export function setProperty<TSource extends IHasExtraProperties>(source: TSource, name: string, value: unknown, validate = true): TSource {
  if (validate) ExtensibleObjectValidator.checkValue(source, name, value);
  source.extraProperties.set(name, value);
  return source;
}

export function removeProperty<TSource extends IHasExtraProperties>(source: TSource, name: string): TSource {
  source.extraProperties.delete(name);
  return source;
}

export function setDefaultsForExtraProperties<TSource extends IHasExtraProperties>(source: TSource, objectType?: Class): TSource {
  const type = objectType ?? (source.constructor as Class);
  for (const property of ObjectExtensionManager.instance.getProperties(type)) {
    if (hasProperty(source, property.name)) continue;
    source.extraProperties.set(property.name, property.getDefaultValue());
  }
  return source;
}

export function setDefaultsForExtraPropertiesOf(source: unknown, objectType: Class): void {
  if (!hasExtraProperties(source)) throw new ArgumentException("Given source object does not implement the IHasExtraProperties interface!", "source");
  setDefaultsForExtraProperties(source, objectType);
}

/** Moves extra properties whose name matches an own property of the object into that property. */
export function setExtraPropertiesToRegularProperties(source: IHasExtraProperties): void {
  const target = source as IHasExtraProperties & Record<string, unknown>;
  for (const name of Object.keys(target)) {
    if (name === "extraProperties" || !source.extraProperties.has(name)) continue;
    target[name] = source.extraProperties.get(name);
    removeProperty(source, name);
  }
}

export function hasSameExtraProperties(source: IHasExtraProperties, other: IHasExtraProperties): boolean {
  return source.extraProperties.hasSameItems(other.extraProperties);
}

export const HasExtraPropertiesExtensions = {
  hasProperty,
  getProperty,
  getPropertyAs,
  setProperty,
  removeProperty,
  setDefaultsForExtraProperties,
  setExtraPropertiesToRegularProperties,
  hasSameExtraProperties,
};
