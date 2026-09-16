import { Transient, createToken } from "@abp/core";
import type { IDistributedCache, KeyValuePair } from "@abp/caching";
import { IFeatureDefinitionManager } from "@abp/features";
import { IGuidGenerator } from "@abp/guids";
import { UnitOfWork } from "@abp/uow";
import { FeatureValueCacheItem, IFeatureValueCache } from "./feature-value-cache-item.js";
import { FeatureValue } from "./feature-value.js";
import { IFeatureValueRepository } from "./repositories.js";

/** Port of `IFeatureManagementStore`. */
export interface IFeatureManagementStore {
  getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined>;
  set(name: string, value: string, providerName: string, providerKey: string | undefined): Promise<void>;
  delete(name: string, providerName: string, providerKey: string | undefined): Promise<void>;
}
export const IFeatureManagementStore = createToken<IFeatureManagementStore>("IFeatureManagementStore");

/**
 * Port of `FeatureManagementStore`: the repository behind a distributed cache of `FeatureValueCacheItem`s. A cache
 * miss loads every feature of the provider/key pair at once (one item per defined feature, missing values cached too).
 */
@Transient(IFeatureManagementStore)
export class FeatureManagementStore implements IFeatureManagementStore {
  static readonly inject = [IFeatureValueRepository, IGuidGenerator, IFeatureValueCache, IFeatureDefinitionManager] as const;

  constructor(
    protected readonly featureValueRepository: IFeatureValueRepository,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly cache: IDistributedCache<FeatureValueCacheItem>,
    protected readonly featureDefinitionManager: IFeatureDefinitionManager,
  ) {}

  @UnitOfWork()
  async getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined> {
    return (await this.getCacheItem(name, providerName, providerKey)).value;
  }

  @UnitOfWork()
  async set(name: string, value: string, providerName: string, providerKey: string | undefined): Promise<void> {
    let featureValue = await this.featureValueRepository.find(name, providerName, providerKey);
    if (featureValue === undefined) {
      featureValue = new FeatureValue(this.guidGenerator.create(), name, value, providerName, providerKey);
      await this.featureValueRepository.insert(featureValue, true);
    } else {
      featureValue.value = value;
      await this.featureValueRepository.update(featureValue, true);
    }

    await this.cache.set(this.calculateCacheKey(name, providerName, providerKey), new FeatureValueCacheItem(featureValue.value), undefined, { considerUow: true });
  }

  @UnitOfWork()
  async delete(name: string, providerName: string, providerKey: string | undefined): Promise<void> {
    const featureValues = await this.featureValueRepository.findAll(name, providerName, providerKey);
    for (const featureValue of featureValues) {
      await this.featureValueRepository.delete(featureValue, true);
      await this.cache.remove(this.calculateCacheKey(name, providerName, providerKey), { considerUow: true });
    }
  }

  protected async getCacheItem(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<FeatureValueCacheItem> {
    const cacheKey = this.calculateCacheKey(name, providerName, providerKey);
    const cacheItem = await this.cache.get(cacheKey, { considerUow: true });
    if (cacheItem !== undefined) return cacheItem;

    const created = new FeatureValueCacheItem();
    await this.setCacheItems(providerName, providerKey, name, created);
    return created;
  }

  private async setCacheItems(providerName: string | undefined, providerKey: string | undefined, currentName: string, currentCacheItem: FeatureValueCacheItem): Promise<void> {
    const featureDefinitions = await this.featureDefinitionManager.getAll();
    const featuresDictionary = new Map((await this.featureValueRepository.getList(providerName, providerKey)).map((f) => [f.name, f.value]));

    const cacheItems: KeyValuePair<string, FeatureValueCacheItem>[] = [];
    for (const featureDefinition of featureDefinitions) {
      const featureValue = featuresDictionary.get(featureDefinition.name);
      cacheItems.push({ key: this.calculateCacheKey(featureDefinition.name, providerName, providerKey), value: new FeatureValueCacheItem(featureValue) });
      if (featureDefinition.name === currentName) currentCacheItem.value = featureValue;
    }

    await this.cache.setMany(cacheItems, undefined, { considerUow: true });
  }

  protected calculateCacheKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
    return FeatureValueCacheItem.calculateCacheKey(name, providerName, providerKey);
  }
}
