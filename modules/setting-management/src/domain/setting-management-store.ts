import { Check, Transient, createToken } from "@abp/core";
import type { IDistributedCache, KeyValuePair } from "@abp/caching";
import { IGuidGenerator } from "@abp/guids";
import { ISettingDefinitionManager, SettingValue } from "@abp/settings";
import { UnitOfWork } from "@abp/uow";
import { ISettingRepository } from "./repositories.js";
import { ISettingCache, SettingCacheItem } from "./setting-cache-item.js";
import { Setting } from "./setting.js";

/** Port of `ISettingManagementStore`. */
export interface ISettingManagementStore {
  getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined>;
  /** `GetListAsync(providerName, providerKey)`: every stored value of the provider (not cached). */
  getList(providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]>;
  /** `GetListAsync(names, providerName, providerKey)`: the cached values of the given settings. */
  getList(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]>;
  set(name: string, value: string, providerName: string | undefined, providerKey: string | undefined): Promise<void>;
  delete(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<void>;
}
export const ISettingManagementStore = createToken<ISettingManagementStore>("ISettingManagementStore");

/**
 * Port of `SettingManagementStore`: the repository behind a distributed cache of `SettingCacheItem`s. A cache miss
 * loads every setting of the provider/key pair at once (one item per defined setting, missing values cached too).
 */
@Transient(ISettingManagementStore)
export class SettingManagementStore implements ISettingManagementStore {
  static readonly inject = [ISettingRepository, IGuidGenerator, ISettingCache, ISettingDefinitionManager] as const;

  constructor(
    protected readonly settingRepository: ISettingRepository,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly cache: IDistributedCache<SettingCacheItem>,
    protected readonly settingDefinitionManager: ISettingDefinitionManager,
  ) {}

  @UnitOfWork()
  async getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined> {
    return (await this.getCacheItem(name, providerName, providerKey)).value;
  }

  @UnitOfWork()
  async set(name: string, value: string, providerName: string | undefined, providerKey: string | undefined): Promise<void> {
    let setting = await this.settingRepository.find(name, providerName, providerKey);
    if (setting === undefined) {
      setting = new Setting(this.guidGenerator.create(), name, value, providerName, providerKey);
      await this.settingRepository.insert(setting, true);
    } else {
      setting.value = value;
      await this.settingRepository.update(setting, true);
    }

    await this.cache.set(this.calculateCacheKey(name, providerName, providerKey), new SettingCacheItem(setting.value), undefined, { considerUow: true });
  }

  getList(providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]>;
  getList(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]>;
  @UnitOfWork()
  async getList(first: string | undefined | readonly string[], second: string | undefined, third?: string | undefined): Promise<SettingValue[]> {
    if (Array.isArray(first)) return this.getListByNames(first as readonly string[], second, third);
    const settings = await this.settingRepository.getList(first as string | undefined, second);
    return settings.map((s) => new SettingValue(s.name, s.value));
  }

  @UnitOfWork()
  async delete(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<void> {
    const setting = await this.settingRepository.find(name, providerName, providerKey);
    if (setting === undefined) return;
    await this.settingRepository.delete(setting, true);
    await this.cache.remove(this.calculateCacheKey(name, providerName, providerKey), { considerUow: true });
  }

  protected async getListByNames(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]> {
    Check.notNullOrEmptyArray(names, "names");

    if (names.length === 1) {
      const name = names[0]!;
      return [new SettingValue(name, (await this.getCacheItem(name, providerName, providerKey)).value)];
    }

    const cacheItems = await this.getCacheItems(names, providerName, providerKey);
    return cacheItems.map((item) => new SettingValue(this.getSettingNameFormCacheKeyOrNull(item.key) ?? "", item.value?.value));
  }

  protected async getCacheItem(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<SettingCacheItem> {
    const cacheKey = this.calculateCacheKey(name, providerName, providerKey);
    const cacheItem = await this.cache.get(cacheKey, { considerUow: true });
    if (cacheItem !== undefined) return cacheItem;

    const created = new SettingCacheItem();
    await this.setCacheItemsForProvider(providerName, providerKey, name, created);
    return created;
  }

  private async setCacheItemsForProvider(providerName: string | undefined, providerKey: string | undefined, currentName: string, currentCacheItem: SettingCacheItem): Promise<void> {
    const settingDefinitions = await this.settingDefinitionManager.getAll();
    const settingsDictionary = new Map((await this.settingRepository.getList(providerName, providerKey)).map((s) => [s.name, s.value]));

    const cacheItems: KeyValuePair<string, SettingCacheItem>[] = [];
    for (const settingDefinition of settingDefinitions) {
      const settingValue = settingsDictionary.get(settingDefinition.name);
      cacheItems.push({ key: this.calculateCacheKey(settingDefinition.name, providerName, providerKey), value: new SettingCacheItem(settingValue) });
      if (settingDefinition.name === currentName) currentCacheItem.value = settingValue;
    }

    await this.cache.setMany(cacheItems, undefined, { considerUow: true });
  }

  protected async getCacheItems(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<KeyValuePair<string, SettingCacheItem | undefined>[]> {
    const cacheKeys = names.map((name) => this.calculateCacheKey(name, providerName, providerKey));
    const cacheItems = await this.cache.getMany(cacheKeys, { considerUow: true });
    if (cacheItems.every((x) => x.value !== undefined)) return cacheItems;

    const notCacheKeys = cacheItems.filter((x) => x.value === undefined).map((x) => x.key);
    const newCacheItems = await this.setCacheItemsForKeys(providerName, providerKey, notCacheKeys);

    return cacheKeys.map((key) => {
      const item = newCacheItems.find((x) => x.key === key) ?? cacheItems.find((x) => x.key === key);
      return { key, value: item?.value };
    });
  }

  private async setCacheItemsForKeys(providerName: string | undefined, providerKey: string | undefined, notCacheKeys: readonly string[]): Promise<KeyValuePair<string, SettingCacheItem>[]> {
    const settingNames = new Set(notCacheKeys.map((key) => this.getSettingNameFormCacheKeyOrNull(key)).filter((name): name is string => name !== undefined));
    const settingDefinitions = (await this.settingDefinitionManager.getAll()).filter((x) => settingNames.has(x.name));
    const settingsDictionary = new Map((await this.settingRepository.getList([...settingNames], providerName, providerKey)).map((s) => [s.name, s.value]));

    const cacheItems: KeyValuePair<string, SettingCacheItem>[] = settingDefinitions.map((settingDefinition) => ({
      key: this.calculateCacheKey(settingDefinition.name, providerName, providerKey),
      value: new SettingCacheItem(settingsDictionary.get(settingDefinition.name)),
    }));

    await this.cache.setMany(cacheItems, undefined, { considerUow: true });
    return cacheItems;
  }

  protected calculateCacheKey(name: string, providerName: string | undefined, providerKey: string | undefined): string {
    return SettingCacheItem.calculateCacheKey(name, providerName, providerKey);
  }

  protected getSettingNameFormCacheKeyOrNull(key: string): string | undefined {
    return SettingCacheItem.getSettingNameFormCacheKeyOrNull(key);
  }
}
