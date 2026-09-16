import { AbpException, Check, IServiceProviderToken, Singleton, createToken, optionsToken, type Guid, type IOptions, type IServiceProvider } from "@abp/core";
import { ConfigurationSettingValueProvider, DefaultValueSettingValueProvider, GlobalSettingValueProvider, ISettingDefinitionManager, ISettingEncryptionService, SettingValue, TenantSettingValueProvider, UserSettingValueProvider } from "@abp/settings";
import { SettingManagementOptions } from "./setting-management-options.js";
import type { ISettingManagementProvider } from "./setting-management-provider.js";
import { ISettingManagementStore } from "./setting-management-store.js";

/** Port of `ISettingManager`. */
export interface ISettingManager {
  getOrNull(name: string, providerName: string, providerKey: string | undefined, fallback?: boolean): Promise<string | undefined>;
  getAll(providerName: string, providerKey: string | undefined, fallback?: boolean): Promise<SettingValue[]>;
  /** A `value` of undefined clears the setting for the provider. */
  set(name: string, value: string | undefined, providerName: string, providerKey: string | undefined, forceToSet?: boolean): Promise<void>;
  /** Deletes every stored value of the provider/key pair. */
  delete(providerName: string, providerKey: string | undefined): Promise<void>;
}
export const ISettingManager = createToken<ISettingManager>("ISettingManager");

function skipWhile<T>(items: readonly T[], predicate: (item: T) => boolean): T[] {
  const index = items.findIndex((item) => !predicate(item));
  return index < 0 ? [] : items.slice(index);
}

function takeWhile<T>(items: readonly T[], predicate: (item: T) => boolean): T[] {
  const index = items.findIndex((item) => !predicate(item));
  return index < 0 ? [...items] : items.slice(0, index);
}

/**
 * Port of `SettingManager`. Providers are consulted from the most specific (last registered) one down to the
 * defaults; `fallback` (and a non-inherited definition) stops at the requested provider.
 */
@Singleton(ISettingManager)
export class SettingManager implements ISettingManager {
  static readonly inject = [optionsToken(SettingManagementOptions), IServiceProviderToken, ISettingDefinitionManager, ISettingEncryptionService, ISettingManagementStore] as const;
  protected readonly options: SettingManagementOptions;
  private resolvedProviders: ISettingManagementProvider[] | undefined;

  constructor(
    options: IOptions<SettingManagementOptions>,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly settingDefinitionManager: ISettingDefinitionManager,
    protected readonly settingEncryptionService: ISettingEncryptionService,
    protected readonly settingManagementStore: ISettingManagementStore,
  ) {
    this.options = options.value;
  }

  protected get providers(): readonly ISettingManagementProvider[] {
    this.resolvedProviders ??= this.options.providers.toArray().map((type) => this.serviceProvider.getRequired(type));
    return this.resolvedProviders;
  }

  async getOrNull(name: string, providerName: string, providerKey: string | undefined, fallback = true): Promise<string | undefined> {
    Check.notNull(name, "name");
    Check.notNull(providerName, "providerName");
    return this.getOrNullInternal(name, providerName, providerKey, fallback);
  }

  async getAll(providerName: string, providerKey: string | undefined, fallback = true): Promise<SettingValue[]> {
    Check.notNull(providerName, "providerName");

    const settingDefinitions = await this.settingDefinitionManager.getAll();
    let providers = skipWhile([...this.providers].reverse(), (p) => p.name !== providerName);
    if (!fallback) providers = takeWhile(providers, (p) => p.name === providerName);

    const providerList = providers.reverse();
    if (providerList.length === 0) return [];

    const settingValues = new Map<string, SettingValue>();
    for (const setting of settingDefinitions) {
      const settingProviderList = setting.providers.length > 0 ? providerList.filter((p) => setting.providers.includes(p.name)) : providerList;
      if (settingProviderList.length === 0) continue;

      let value: string | undefined;
      if (setting.isInherited) {
        for (const provider of settingProviderList) {
          const providerValue = await provider.getOrNull(setting, provider.name === providerName ? providerKey : undefined);
          if (providerValue !== undefined) value = providerValue;
        }
      } else {
        value = await settingProviderList[0]!.getOrNull(setting, providerKey);
      }

      if (setting.isEncrypted) value = this.settingEncryptionService.decrypt(setting, value);
      if (value !== undefined) settingValues.set(setting.name, new SettingValue(setting.name, value));
    }

    return [...settingValues.values()];
  }

  async set(name: string, value: string | undefined, providerName: string, providerKey: string | undefined, forceToSet = false): Promise<void> {
    Check.notNull(name, "name");
    Check.notNull(providerName, "providerName");

    const setting = await this.settingDefinitionManager.get(name);
    if (setting.providers.length > 0 && !setting.providers.includes(providerName)) {
      throw new AbpException(`The setting named '${name}' is not compatible with the provider named '${providerName}'`);
    }

    let providers = skipWhile([...this.providers].reverse(), (p) => p.name !== providerName);
    if (providers.length === 0) throw new AbpException(`Unknown setting value provider: ${providerName}`);

    if (setting.isEncrypted) value = this.settingEncryptionService.encrypt(setting, value);

    if (providers.length > 1 && !forceToSet && setting.isInherited && value !== undefined) {
      const fallbackValue = await this.getOrNullInternal(name, providers[1]!.name, undefined);
      if (fallbackValue !== undefined && fallbackValue.toLowerCase() === value.toLowerCase()) value = undefined;
    }

    providers = takeWhile(providers, (p) => p.name === providerName);

    if (value === undefined) {
      for (const provider of providers) await provider.clear(setting, providerKey);
    } else {
      for (const provider of providers) await provider.set(setting, value, providerKey);
    }
  }

  async delete(providerName: string, providerKey: string | undefined): Promise<void> {
    const settings = await this.settingManagementStore.getList(providerName, providerKey);
    for (const setting of settings) await this.settingManagementStore.delete(setting.name, providerName, providerKey);
  }

  protected async getOrNullInternal(name: string, providerName: string | undefined, providerKey: string | undefined, fallback = true): Promise<string | undefined> {
    const setting = await this.settingDefinitionManager.get(name);
    let providers: ISettingManagementProvider[] = [...this.providers].reverse();

    if (providerName !== undefined) providers = skipWhile(providers, (p) => p.name !== providerName);
    if (!fallback || !setting.isInherited) providers = takeWhile(providers, (p) => p.name === providerName);
    if (setting.providers.length > 0) providers = providers.filter((p) => setting.providers.includes(p.name));

    let value: string | undefined;
    for (const provider of providers) {
      value = await provider.getOrNull(setting, provider.name === providerName ? providerKey : undefined);
      if (value !== undefined) break;
    }

    if (setting.isEncrypted) value = this.settingEncryptionService.decrypt(setting, value);
    return value;
  }
}

/**
 * Port of the `*SettingManagerExtensions` classes (`GetOrNullGlobalAsync`, `SetForTenantAsync`, ...) as plain
 * functions taking the manager first.
 */
export const SettingManagerExtensions = {
  getOrNullDefault(settingManager: ISettingManager, name: string, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, DefaultValueSettingValueProvider.ProviderName, undefined, fallback);
  },
  getAllDefault(settingManager: ISettingManager, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(DefaultValueSettingValueProvider.ProviderName, undefined, fallback);
  },
  getOrNullConfiguration(settingManager: ISettingManager, name: string, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, ConfigurationSettingValueProvider.ProviderName, undefined, fallback);
  },
  getAllConfiguration(settingManager: ISettingManager, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(ConfigurationSettingValueProvider.ProviderName, undefined, fallback);
  },
  getOrNullGlobal(settingManager: ISettingManager, name: string, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, GlobalSettingValueProvider.ProviderName, undefined, fallback);
  },
  getAllGlobal(settingManager: ISettingManager, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(GlobalSettingValueProvider.ProviderName, undefined, fallback);
  },
  setGlobal(settingManager: ISettingManager, name: string, value: string | undefined): Promise<void> {
    return settingManager.set(name, value, GlobalSettingValueProvider.ProviderName, undefined);
  },
  getOrNullForTenant(settingManager: ISettingManager, name: string, tenantId: Guid, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, TenantSettingValueProvider.ProviderName, tenantId, fallback);
  },
  getOrNullForCurrentTenant(settingManager: ISettingManager, name: string, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, TenantSettingValueProvider.ProviderName, undefined, fallback);
  },
  getAllForTenant(settingManager: ISettingManager, tenantId: Guid, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(TenantSettingValueProvider.ProviderName, tenantId, fallback);
  },
  getAllForCurrentTenant(settingManager: ISettingManager, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(TenantSettingValueProvider.ProviderName, undefined, fallback);
  },
  setForTenant(settingManager: ISettingManager, tenantId: Guid, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    return settingManager.set(name, value, TenantSettingValueProvider.ProviderName, tenantId, forceToSet);
  },
  setForCurrentTenant(settingManager: ISettingManager, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    return settingManager.set(name, value, TenantSettingValueProvider.ProviderName, undefined, forceToSet);
  },
  setForTenantOrGlobal(settingManager: ISettingManager, tenantId: Guid | undefined, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    if (tenantId !== undefined) return SettingManagerExtensions.setForTenant(settingManager, tenantId, name, value, forceToSet);
    return SettingManagerExtensions.setGlobal(settingManager, name, value);
  },
  getOrNullForUser(settingManager: ISettingManager, name: string, userId: Guid, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, UserSettingValueProvider.ProviderName, userId, fallback);
  },
  getOrNullForCurrentUser(settingManager: ISettingManager, name: string, fallback = true): Promise<string | undefined> {
    return settingManager.getOrNull(name, UserSettingValueProvider.ProviderName, undefined, fallback);
  },
  getAllForUser(settingManager: ISettingManager, userId: Guid, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(UserSettingValueProvider.ProviderName, userId, fallback);
  },
  getAllForCurrentUser(settingManager: ISettingManager, fallback = true): Promise<SettingValue[]> {
    return settingManager.getAll(UserSettingValueProvider.ProviderName, undefined, fallback);
  },
  setForUser(settingManager: ISettingManager, userId: Guid, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    return settingManager.set(name, value, UserSettingValueProvider.ProviderName, userId, forceToSet);
  },
  setForCurrentUser(settingManager: ISettingManager, name: string, value: string | undefined, forceToSet = false): Promise<void> {
    return settingManager.set(name, value, UserSettingValueProvider.ProviderName, undefined, forceToSet);
  },
};
