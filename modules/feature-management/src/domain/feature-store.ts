import { Dependency, Transient } from "@abp/core";
import { IFeatureStore } from "@abp/features";
import { IFeatureManagementStore } from "./feature-management-store.js";

/** Port of `FeatureStore`: replaces `NullFeatureStore` of `@abp/features` with the managed (cached) store. */
@Dependency({ replaceServices: true })
@Transient(IFeatureStore)
export class FeatureStore implements IFeatureStore {
  static readonly inject = [IFeatureManagementStore] as const;

  constructor(protected readonly featureManagementStore: IFeatureManagementStore) {}

  getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined> {
    return this.featureManagementStore.getOrNull(name, providerName, providerKey);
  }
}
