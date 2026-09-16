import { EventName } from "@abp/event-bus";

/** Port of `DynamicPermissionDefinitionsChangedEto`: published when static permission definitions were written to the database. */
@EventName("abp.permission-management.dynamic-permission-definitions-changed")
export class DynamicPermissionDefinitionsChangedEto {
  permissions: string[] = [];

  constructor(permissions: string[] = []) {
    this.permissions = permissions;
  }
}
