import { Check, type Class } from "@abp/core";
import { setProperty, type IHasExtraProperties } from "./data/has-extra-properties.js";
import { MappingPropertyDefinitionChecks } from "./mapping-property-definition-checks.js";
import type { ObjectExtensionInfo } from "./object-extension-info.js";
import { ObjectExtensionManager } from "./object-extension-manager.js";

/**
 * Port of `ExtensibleObjectMapper`. The source/destination classes come from the objects' constructors
 * (ABP uses the generic type arguments); the dictionary overloads take the classes explicitly.
 */
export const ExtensibleObjectMapper = {
  mapExtraPropertiesTo<TSource extends IHasExtraProperties, TDestination extends IHasExtraProperties>(source: TSource, destination: TDestination, definitionChecks?: MappingPropertyDefinitionChecks, ignoredProperties?: readonly string[]): void {
    Check.notNull(source, "source");
    Check.notNull(destination, "destination");
    Check.notNull(source.extraProperties, "source.extraProperties");
    Check.notNull(destination.extraProperties, "destination.extraProperties");
    const sourceObjectExtension = ObjectExtensionManager.instance.getOrNull(classOf(source));
    const destinationObjectExtension = ObjectExtensionManager.instance.getOrNull(classOf(destination));
    for (const [key, value] of source.extraProperties) {
      if (canMapProperty(key, sourceObjectExtension, destinationObjectExtension, definitionChecks, ignoredProperties)) setProperty(destination, key, value);
    }
  },

  mapExtraPropertyDictionaryTo(sourceType: Class, destinationType: Class, sourceDictionary: ReadonlyMap<string, unknown>, destinationDictionary: Map<string, unknown>, definitionChecks?: MappingPropertyDefinitionChecks, ignoredProperties?: readonly string[]): void {
    Check.notNull(sourceDictionary, "sourceDictionary");
    Check.notNull(destinationDictionary, "destinationDictionary");
    const sourceObjectExtension = ObjectExtensionManager.instance.getOrNull(sourceType);
    const destinationObjectExtension = ObjectExtensionManager.instance.getOrNull(destinationType);
    for (const [key, value] of sourceDictionary) {
      if (canMapProperty(key, sourceObjectExtension, destinationObjectExtension, definitionChecks, ignoredProperties)) destinationDictionary.set(key, value);
    }
  },

  canMapProperty(sourceType: Class, destinationType: Class, propertyName: string, definitionChecks?: MappingPropertyDefinitionChecks, ignoredProperties?: readonly string[]): boolean {
    Check.notNull(propertyName, "propertyName");
    return canMapProperty(propertyName, ObjectExtensionManager.instance.getOrNull(sourceType), ObjectExtensionManager.instance.getOrNull(destinationType), definitionChecks, ignoredProperties);
  },
};

/** Port of `HasExtraPropertiesObjectExtendingExtensions.MapExtraPropertiesTo`. */
export function mapExtraPropertiesTo<TSource extends IHasExtraProperties, TDestination extends IHasExtraProperties>(source: TSource, destination: TDestination, definitionChecks?: MappingPropertyDefinitionChecks, ignoredProperties?: readonly string[]): void {
  ExtensibleObjectMapper.mapExtraPropertiesTo(source, destination, definitionChecks, ignoredProperties);
}

function classOf(value: object): Class {
  return value.constructor as Class;
}

function canMapProperty(propertyName: string, sourceObjectExtension: ObjectExtensionInfo | undefined, destinationObjectExtension: ObjectExtensionInfo | undefined, definitionChecks: MappingPropertyDefinitionChecks | undefined, ignoredProperties: readonly string[] | undefined): boolean {
  if (ignoredProperties?.includes(propertyName)) return false;

  if (definitionChecks !== undefined && definitionChecks !== MappingPropertyDefinitionChecks.Null) {
    if (definitionChecks & MappingPropertyDefinitionChecks.Source) {
      if (!sourceObjectExtension?.hasProperty(propertyName)) return false;
    }
    if (definitionChecks & MappingPropertyDefinitionChecks.Destination) {
      if (!destinationObjectExtension?.hasProperty(propertyName)) return false;
    }
    return true;
  }

  const sourcePropertyDefinition = sourceObjectExtension?.getPropertyOrNull(propertyName);
  const destinationPropertyDefinition = destinationObjectExtension?.getPropertyOrNull(propertyName);
  if (sourcePropertyDefinition) {
    if (destinationPropertyDefinition) return true;
    if (sourcePropertyDefinition.checkPairDefinitionOnMapping === false) return true;
  } else if (destinationPropertyDefinition) {
    if (destinationPropertyDefinition.checkPairDefinitionOnMapping === false) return true;
  }
  return false;
}
