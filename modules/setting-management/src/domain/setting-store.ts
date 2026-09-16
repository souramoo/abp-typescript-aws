import { Dependency, Transient } from "@abp/core";
import { ISettingStore, type SettingValue } from "@abp/settings";
import { ISettingManagementStore } from "./setting-management-store.js";

/** Port of `SettingStore`: replaces `NullSettingStore` of `@abp/settings` with the managed (cached) store. */
@Dependency({ replaceServices: true })
@Transient(ISettingStore)
export class SettingStore implements ISettingStore {
  static readonly inject = [ISettingManagementStore] as const;

  constructor(protected readonly managementStore: ISettingManagementStore) {}

  getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined> {
    return this.managementStore.getOrNull(name, providerName, providerKey);
  }

  getAll(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]> {
    return this.managementStore.getList(names, providerName, providerKey);
  }
}
