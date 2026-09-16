import { Check, type Guid } from "@abp/core";
import { BasicAggregateRoot } from "@abp/ddd-domain";
import { ExtraPropertyDictionary, hasSameExtraProperties, setDefaultsForExtraProperties, type IHasExtraProperties } from "@abp/object-extending";
import { FeatureDefinitionRecordConsts, FeatureGroupDefinitionRecordConsts } from "../domain-shared/index.js";

function optionalLength(value: string | undefined, parameterName: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : Check.length(value, parameterName, maxLength);
}

function replaceExtraProperties(target: IHasExtraProperties, source: IHasExtraProperties): void {
  if (hasSameExtraProperties(target, source)) return;
  target.extraProperties.clear();
  for (const [key, value] of source.extraProperties) target.extraProperties.set(key, value);
}

/** Port of `FeatureGroupDefinitionRecord`. */
export class FeatureGroupDefinitionRecord extends BasicAggregateRoot<Guid> implements IHasExtraProperties {
  name: string;
  displayName: string;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(id: Guid, name: string, displayName: string) {
    super(id);
    this.name = Check.notNullOrWhiteSpace(name, "name", FeatureGroupDefinitionRecordConsts.maxNameLength);
    this.displayName = Check.notNullOrWhiteSpace(displayName, "displayName", FeatureGroupDefinitionRecordConsts.maxDisplayNameLength);
    setDefaultsForExtraProperties(this);
  }

  hasSameData(otherRecord: FeatureGroupDefinitionRecord): boolean {
    return this.name === otherRecord.name && this.displayName === otherRecord.displayName && hasSameExtraProperties(this, otherRecord);
  }

  patch(otherRecord: FeatureGroupDefinitionRecord): void {
    this.name = otherRecord.name;
    this.displayName = otherRecord.displayName;
    replaceExtraProperties(this, otherRecord);
  }
}

/** Port of `FeatureDefinitionRecord`. `valueType` holds the JSON of the `IStringValueType` (see `StringValueTypeSerializer`). */
export class FeatureDefinitionRecord extends BasicAggregateRoot<Guid> implements IHasExtraProperties {
  groupName: string;
  name: string;
  parentName: string | undefined;
  displayName: string;
  description: string | undefined;
  defaultValue: string | undefined;
  isVisibleToClients: boolean;
  isAvailableToHost: boolean;
  /** Comma separated list of provider names. */
  allowedProviders: string | undefined;
  /** Serialized string to store info about the ValueType. */
  valueType: string;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(id: Guid, groupName: string, name: string, parentName: string | undefined, displayName: string, description: string | undefined, defaultValue: string | undefined, isVisibleToClients: boolean, isAvailableToHost: boolean, allowedProviders: string | undefined, valueType: string) {
    super(id);
    this.groupName = Check.notNullOrWhiteSpace(groupName, "groupName", FeatureDefinitionRecordConsts.maxNameLength);
    this.name = Check.notNullOrWhiteSpace(name, "name", FeatureDefinitionRecordConsts.maxNameLength);
    this.parentName = optionalLength(parentName, "parentName", FeatureDefinitionRecordConsts.maxNameLength);
    this.displayName = Check.notNullOrWhiteSpace(displayName, "displayName", FeatureDefinitionRecordConsts.maxDisplayNameLength);
    this.description = optionalLength(description, "description", FeatureDefinitionRecordConsts.maxDescriptionLength);
    this.defaultValue = optionalLength(defaultValue, "defaultValue", FeatureDefinitionRecordConsts.maxDefaultValueLength);
    this.isVisibleToClients = isVisibleToClients;
    this.isAvailableToHost = isAvailableToHost;
    this.allowedProviders = optionalLength(allowedProviders, "allowedProviders", FeatureDefinitionRecordConsts.maxAllowedProvidersLength);
    this.valueType = Check.notNullOrWhiteSpace(valueType, "valueType", FeatureDefinitionRecordConsts.maxValueTypeLength);
    setDefaultsForExtraProperties(this);
  }

  hasSameData(otherRecord: FeatureDefinitionRecord): boolean {
    return (
      this.name === otherRecord.name &&
      this.groupName === otherRecord.groupName &&
      this.parentName === otherRecord.parentName &&
      this.displayName === otherRecord.displayName &&
      this.description === otherRecord.description &&
      this.defaultValue === otherRecord.defaultValue &&
      this.isVisibleToClients === otherRecord.isVisibleToClients &&
      this.isAvailableToHost === otherRecord.isAvailableToHost &&
      this.allowedProviders === otherRecord.allowedProviders &&
      this.valueType === otherRecord.valueType &&
      hasSameExtraProperties(this, otherRecord)
    );
  }

  patch(otherRecord: FeatureDefinitionRecord): void {
    this.name = otherRecord.name;
    this.groupName = otherRecord.groupName;
    this.parentName = otherRecord.parentName;
    this.displayName = otherRecord.displayName;
    this.description = otherRecord.description;
    this.defaultValue = otherRecord.defaultValue;
    this.isVisibleToClients = otherRecord.isVisibleToClients;
    this.isAvailableToHost = otherRecord.isAvailableToHost;
    this.allowedProviders = otherRecord.allowedProviders;
    this.valueType = otherRecord.valueType;
    replaceExtraProperties(this, otherRecord);
  }
}
