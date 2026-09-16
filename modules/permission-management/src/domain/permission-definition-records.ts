import { Check, createToken, type Guid } from "@abp/core";
import { BasicAggregateRoot, type IBasicRepository } from "@abp/ddd-domain";
import { MultiTenancySides } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary, hasSameExtraProperties, setDefaultsForExtraProperties, type IHasExtraProperties } from "@abp/object-extending";
import { PermissionDefinitionRecordConsts, PermissionGroupDefinitionRecordConsts } from "../domain-shared/index.js";

/** Port of `PermissionGroupDefinitionRecord`: a permission group definition persisted for the dynamic definition store. */
export class PermissionGroupDefinitionRecord extends BasicAggregateRoot<Guid> implements IHasExtraProperties {
  name!: string;
  displayName!: string;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(id?: Guid, name?: string, displayName?: string) {
    super(id);
    if (id !== undefined) {
      this.name = Check.notNullOrWhiteSpace(name, "name", PermissionGroupDefinitionRecordConsts.maxNameLength);
      this.displayName = Check.notNullOrWhiteSpace(displayName, "displayName", PermissionGroupDefinitionRecordConsts.maxDisplayNameLength);
    }
    setDefaultsForExtraProperties(this, new.target);
  }

  hasSameData(otherRecord: PermissionGroupDefinitionRecord): boolean {
    return this.name === otherRecord.name && this.displayName === otherRecord.displayName && hasSameExtraProperties(this, otherRecord);
  }

  patch(otherRecord: PermissionGroupDefinitionRecord): void {
    if (this.name !== otherRecord.name) this.name = otherRecord.name;
    if (this.displayName !== otherRecord.displayName) this.displayName = otherRecord.displayName;
    if (!hasSameExtraProperties(this, otherRecord)) {
      this.extraProperties.clear();
      for (const [key, value] of otherRecord.extraProperties) this.extraProperties.set(key, value);
    }
  }
}

export interface PermissionDefinitionRecordInit {
  id: Guid;
  groupName: string | undefined;
  name: string;
  resourceName?: string;
  managementPermissionName?: string;
  parentName?: string;
  displayName: string;
  isEnabled?: boolean;
  multiTenancySide?: MultiTenancySides;
  providers?: string;
  stateCheckers?: string;
}

/** Port of `PermissionDefinitionRecord`: a permission definition persisted for the dynamic definition store. */
export class PermissionDefinitionRecord extends BasicAggregateRoot<Guid> implements IHasExtraProperties {
  groupName: string | undefined = undefined;
  name!: string;
  resourceName: string | undefined = undefined;
  managementPermissionName: string | undefined = undefined;
  parentName: string | undefined = undefined;
  displayName!: string;
  isEnabled = true;
  multiTenancySide: MultiTenancySides = MultiTenancySides.Both;
  /** Comma separated list of provider names. */
  providers: string | undefined = undefined;
  /** Serialized string to store info about the state checkers. */
  stateCheckers: string | undefined = undefined;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(init?: PermissionDefinitionRecordInit) {
    super(init?.id);
    if (init) {
      this.groupName = init.groupName;
      if (init.resourceName === undefined) this.groupName = Check.notNullOrWhiteSpace(init.groupName, "groupName", PermissionGroupDefinitionRecordConsts.maxNameLength);
      this.name = Check.notNullOrWhiteSpace(init.name, "name", PermissionDefinitionRecordConsts.maxNameLength);
      this.resourceName = init.resourceName;
      this.managementPermissionName = init.managementPermissionName;
      this.parentName = init.parentName === undefined ? undefined : Check.length(init.parentName, "parentName", PermissionDefinitionRecordConsts.maxNameLength);
      this.displayName = Check.notNullOrWhiteSpace(init.displayName, "displayName", PermissionDefinitionRecordConsts.maxDisplayNameLength);
      this.isEnabled = init.isEnabled ?? true;
      this.multiTenancySide = init.multiTenancySide ?? MultiTenancySides.Both;
      this.providers = init.providers;
      this.stateCheckers = init.stateCheckers;
    }
    setDefaultsForExtraProperties(this, new.target);
  }

  hasSameData(otherRecord: PermissionDefinitionRecord): boolean {
    return (
      this.name === otherRecord.name &&
      this.resourceName === otherRecord.resourceName &&
      this.managementPermissionName === otherRecord.managementPermissionName &&
      this.groupName === otherRecord.groupName &&
      this.parentName === otherRecord.parentName &&
      this.displayName === otherRecord.displayName &&
      this.isEnabled === otherRecord.isEnabled &&
      this.multiTenancySide === otherRecord.multiTenancySide &&
      this.providers === otherRecord.providers &&
      this.stateCheckers === otherRecord.stateCheckers &&
      hasSameExtraProperties(this, otherRecord)
    );
  }

  patch(otherRecord: PermissionDefinitionRecord): void {
    if (this.name !== otherRecord.name) this.name = otherRecord.name;
    if (this.resourceName !== otherRecord.resourceName) this.resourceName = otherRecord.resourceName;
    if (this.managementPermissionName !== otherRecord.managementPermissionName) this.managementPermissionName = otherRecord.managementPermissionName;
    if (this.groupName !== otherRecord.groupName) this.groupName = otherRecord.groupName;
    if (this.parentName !== otherRecord.parentName) this.parentName = otherRecord.parentName;
    if (this.displayName !== otherRecord.displayName) this.displayName = otherRecord.displayName;
    if (this.isEnabled !== otherRecord.isEnabled) this.isEnabled = otherRecord.isEnabled;
    if (this.multiTenancySide !== otherRecord.multiTenancySide) this.multiTenancySide = otherRecord.multiTenancySide;
    if (this.providers !== otherRecord.providers) this.providers = otherRecord.providers;
    if (this.stateCheckers !== otherRecord.stateCheckers) this.stateCheckers = otherRecord.stateCheckers;
    if (!hasSameExtraProperties(this, otherRecord)) {
      this.extraProperties.clear();
      for (const [key, value] of otherRecord.extraProperties) this.extraProperties.set(key, value);
    }
  }
}

/** Port of `IPermissionGroupDefinitionRecordRepository`. */
export type IPermissionGroupDefinitionRecordRepository = IBasicRepository<PermissionGroupDefinitionRecord, Guid>;
export const IPermissionGroupDefinitionRecordRepository = createToken<IPermissionGroupDefinitionRecordRepository>("IPermissionGroupDefinitionRecordRepository");

/** Port of `IPermissionDefinitionRecordRepository`. */
export interface IPermissionDefinitionRecordRepository extends IBasicRepository<PermissionDefinitionRecord, Guid> {
  findByName(name: string, signal?: AbortSignal): Promise<PermissionDefinitionRecord | undefined>;
}
export const IPermissionDefinitionRecordRepository = createToken<IPermissionDefinitionRecordRepository>("IPermissionDefinitionRecordRepository");
