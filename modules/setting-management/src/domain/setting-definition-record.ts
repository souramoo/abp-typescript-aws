import { Check, type Guid } from "@abp/core";
import { BasicAggregateRoot } from "@abp/ddd-domain";
import { ExtraPropertyDictionary, hasSameExtraProperties, setDefaultsForExtraProperties, type IHasExtraProperties } from "@abp/object-extending";
import { SettingDefinitionRecordConsts } from "../domain-shared/index.js";

function optionalLength(value: string | undefined, parameterName: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : Check.length(value, parameterName, maxLength);
}

/** Port of `SettingDefinitionRecord`: a static setting definition persisted for the dynamic definition store. */
export class SettingDefinitionRecord extends BasicAggregateRoot<Guid> implements IHasExtraProperties {
  /** Unique name of the setting. */
  name: string;
  displayName: string;
  description: string | undefined;
  /** Default value of the setting. */
  defaultValue: string | undefined;
  /** Can clients see this setting and its value. Default: false. */
  isVisibleToClients: boolean;
  /** Comma separated list of provider names. */
  providers: string | undefined;
  /** Is this setting inherited from parent scopes. Default: true. */
  isInherited: boolean;
  /** Is this setting stored as encrypted in the data source. Default: false. */
  isEncrypted: boolean;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(id: Guid, name: string, displayName: string, description: string | undefined, defaultValue: string | undefined, isVisibleToClients: boolean, providers: string | undefined, isInherited: boolean, isEncrypted: boolean) {
    super(id);
    this.name = Check.notNullOrWhiteSpace(name, "name", SettingDefinitionRecordConsts.maxNameLength);
    this.displayName = Check.notNullOrWhiteSpace(displayName, "displayName", SettingDefinitionRecordConsts.maxDisplayNameLength);
    this.description = optionalLength(description, "description", SettingDefinitionRecordConsts.maxDescriptionLength);
    this.defaultValue = optionalLength(defaultValue, "defaultValue", SettingDefinitionRecordConsts.maxDefaultValueLength);
    this.isVisibleToClients = isVisibleToClients;
    this.providers = optionalLength(providers, "providers", SettingDefinitionRecordConsts.maxProvidersLength);
    this.isInherited = isInherited;
    this.isEncrypted = isEncrypted;
    setDefaultsForExtraProperties(this);
  }

  hasSameData(otherRecord: SettingDefinitionRecord): boolean {
    return (
      this.name === otherRecord.name &&
      this.displayName === otherRecord.displayName &&
      this.description === otherRecord.description &&
      this.defaultValue === otherRecord.defaultValue &&
      this.isVisibleToClients === otherRecord.isVisibleToClients &&
      this.providers === otherRecord.providers &&
      this.isInherited === otherRecord.isInherited &&
      this.isEncrypted === otherRecord.isEncrypted &&
      hasSameExtraProperties(this, otherRecord)
    );
  }

  patch(otherRecord: SettingDefinitionRecord): void {
    this.name = otherRecord.name;
    this.displayName = otherRecord.displayName;
    this.description = otherRecord.description;
    this.defaultValue = otherRecord.defaultValue;
    this.isVisibleToClients = otherRecord.isVisibleToClients;
    this.providers = otherRecord.providers;
    this.isInherited = otherRecord.isInherited;
    this.isEncrypted = otherRecord.isEncrypted;
    if (!hasSameExtraProperties(this, otherRecord)) {
      this.extraProperties.clear();
      for (const [key, value] of otherRecord.extraProperties) this.extraProperties.set(key, value);
    }
  }
}
