import { Transient, createToken } from "@abp/core";
import type { PermissionDefinition, PermissionGroupDefinition } from "@abp/authorization";
import { IGuidGenerator } from "@abp/guids";
import { ILocalizableStringSerializer } from "@abp/localization";
import { setProperty } from "@abp/object-extending";
import { PermissionDefinitionRecord, PermissionGroupDefinitionRecord } from "./permission-definition-records.js";

export interface SerializedPermissionGroups {
  readonly groupRecords: PermissionGroupDefinitionRecord[];
  readonly permissionRecords: PermissionDefinitionRecord[];
}

/** Port of `IPermissionDefinitionSerializer` (the tuple-returning overload is `serializeGroups`). */
export interface IPermissionDefinitionSerializer {
  serializeGroups(permissionGroups: Iterable<PermissionGroupDefinition>): Promise<SerializedPermissionGroups>;
  serializePermissions(permissions: Iterable<PermissionDefinition>): Promise<PermissionDefinitionRecord[]>;
  serializeGroup(permissionGroup: PermissionGroupDefinition): Promise<PermissionGroupDefinitionRecord>;
  serializePermission(permission: PermissionDefinition, permissionGroup: PermissionGroupDefinition | undefined): Promise<PermissionDefinitionRecord>;
}
export const IPermissionDefinitionSerializer = createToken<IPermissionDefinitionSerializer>("IPermissionDefinitionSerializer");

/**
 * Port of `PermissionDefinitionSerializer`. State checkers are not serialized: `ISimpleStateCheckerSerializer` has no
 * counterpart in this port, so dynamic definitions carry no state checkers (`stateCheckers` stays undefined).
 */
@Transient(IPermissionDefinitionSerializer)
export class PermissionDefinitionSerializer implements IPermissionDefinitionSerializer {
  static readonly inject = [IGuidGenerator, ILocalizableStringSerializer] as const;

  constructor(
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly localizableStringSerializer: ILocalizableStringSerializer,
  ) {}

  async serializeGroups(permissionGroups: Iterable<PermissionGroupDefinition>): Promise<SerializedPermissionGroups> {
    const groupRecords: PermissionGroupDefinitionRecord[] = [];
    const permissionRecords: PermissionDefinitionRecord[] = [];
    for (const permissionGroup of permissionGroups) {
      groupRecords.push(await this.serializeGroup(permissionGroup));
      for (const permission of permissionGroup.getPermissionsWithChildren()) permissionRecords.push(await this.serializePermission(permission, permissionGroup));
    }
    return { groupRecords, permissionRecords };
  }

  async serializePermissions(permissions: Iterable<PermissionDefinition>): Promise<PermissionDefinitionRecord[]> {
    const records: PermissionDefinitionRecord[] = [];
    for (const permission of permissions) records.push(await this.serializePermission(permission, undefined));
    return records;
  }

  async serializeGroup(permissionGroup: PermissionGroupDefinition): Promise<PermissionGroupDefinitionRecord> {
    const record = new PermissionGroupDefinitionRecord(this.guidGenerator.create(), permissionGroup.name, this.localizableStringSerializer.serialize(permissionGroup.displayName));
    for (const [key, value] of permissionGroup.properties) setProperty(record, key, value, false);
    return record;
  }

  async serializePermission(permission: PermissionDefinition, permissionGroup: PermissionGroupDefinition | undefined): Promise<PermissionDefinitionRecord> {
    const record = new PermissionDefinitionRecord({
      id: this.guidGenerator.create(),
      groupName: permissionGroup?.name,
      name: permission.name,
      resourceName: permission.resourceName,
      managementPermissionName: permission.managementPermissionName,
      parentName: permission.parent?.name,
      displayName: this.localizableStringSerializer.serialize(permission.displayName) ?? permission.name,
      isEnabled: permission.isEnabled,
      multiTenancySide: permission.multiTenancySide,
      providers: this.serializeProviders(permission.providers),
      stateCheckers: undefined,
    });
    for (const [key, value] of permission.properties) setProperty(record, key, value, false);
    return record;
  }

  protected serializeProviders(providers: readonly string[]): string | undefined {
    return providers.length > 0 ? providers.join(",") : undefined;
  }
}
